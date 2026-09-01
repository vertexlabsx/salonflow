import type { Request } from "express";
import { Types } from "mongoose";
import { ApiError } from "../../shared/http";
import { BranchModel } from "../../models/branch.model";
import { ConversationModel, type Conversation } from "../../models/conversation.model";
import { ConversationMessageModel, type ConversationMessage } from "../../models/conversation-message.model";
import { UserModel } from "../../models/user.model";
import { resolveAuthorizedBranchIds } from "../../middleware/tenant-context";
import { withTransaction } from "../../config/mongo";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { loadEnv } from "../../config/env";

type Context = NonNullable<Request["context"]>;

const timezone = (loadEnv().SALON_TIMEZONE || "Asia/Kolkata") as "Asia/Kolkata";

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageDto(doc: {
  _id?: unknown;
  conversationId: unknown;
  type: string;
  senderUserId: string;
  senderName: string;
  body: string;
  deliveredCount: number;
  readCount: number;
  createdAt?: Date;
}): Record<string, unknown> {
  return {
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    type: doc.type,
    senderUserId: doc.senderUserId,
    senderName: doc.senderName,
    body: doc.body,
    createdAt: iso(doc.createdAt),
    receipt: { deliveredCount: doc.deliveredCount, readCount: doc.readCount }
  };
}

interface ConversationDoc extends Conversation {
  _id: unknown;
}

function conversationDto(
  doc: ConversationDoc,
  branchName: string,
  messageCount: number,
  unreadCount: number
): Record<string, unknown> {
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    branchId: doc.branchId,
    branchName: branchName || doc.branchId,
    participantUserIds: doc.participantUserIds.length ? [...doc.participantUserIds] : null,
    messageCount,
    unreadCount,
    lastMessageAt: iso(doc.lastMessageAt),
    createdAt: iso(doc.createdAt ?? new Date()),
    updatedAt: iso(doc.updatedAt ?? new Date())
  };
}

async function branchNames(salonId: string, branchIds: string[]): Promise<Map<string, string>> {
  const branches = await BranchModel.find({ salonId, _id: { $in: branchIds } }).select("_id name").lean();
  return new Map(branches.map((b) => [String(b._id), (b as { name?: string }).name || String(b._id)]));
}

async function assertOwnerConversationVisible(context: Context, conversationId: string): Promise<ConversationDoc> {
  if (!Types.ObjectId.isValid(conversationId)) throw ApiError.badRequest("A valid conversation id is required.");
  const conversation = await ConversationModel.findOne({ _id: conversationId, salonId: context.salonId });
  if (!conversation) throw ApiError.notFound("Conversation was not found in your workspace.");
  const visible = conversation.type === "team" || conversation.participantUserIds.includes(context.userId);
  if (!visible) throw ApiError.notFound("Conversation was not found in your workspace.");
  return conversation as unknown as ConversationDoc;
}

function visibilityFilter(context: Context, branchIds: string[]): Record<string, unknown> {
  return {
    salonId: context.salonId,
    branchId: { $in: branchIds.length ? branchIds : [context.branchId] },
    $or: [{ type: "team" }, { type: "private-owner", participantUserIds: context.userId }]
  };
}

async function countsFor(conversationIds: unknown[], context: Context): Promise<{ count: Map<string, number>; unread: Map<string, number> }> {
  const ids = conversationIds.length ? conversationIds : [null];
  const [countRows, unreadRows] = await Promise.all([
    ConversationMessageModel.aggregate([
      { $match: { conversationId: { $in: ids } } },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } }
    ]),
    ConversationMessageModel.aggregate([
      { $match: { conversationId: { $in: ids }, senderUserId: { $ne: context.userId }, readCount: 0 } },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } }
    ])
  ]);
  return {
    count: new Map(countRows.map((row) => [String(row._id), Number(row.count)])),
    unread: new Map(unreadRows.map((row) => [String(row._id), Number(row.count)]))
  };
}

export interface OwnerConversationsQuery {
  branchId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}

/** Owner Console › Operations › Chat list with title/branch search and paging. */
export async function ownerConversations(context: Context, query: OwnerConversationsQuery): Promise<unknown> {
  const pageNumber = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 30, 1), 100);
  const branchIds = resolveAuthorizedBranchIds(context, query.branchId || "all");

  const filter: Record<string, unknown> = visibilityFilter(context, branchIds);
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    const matchedBranches = await BranchModel.find({ _id: { $in: branchIds }, name: pattern }).select("_id").lean();
    const branchMatches = matchedBranches.map((b) => String(b._id));
    delete filter.$or;
    filter.$and = [
      { $or: [{ type: "team" }, { type: "private-owner", participantUserIds: context.userId }] },
      { $or: [{ title: pattern }, { branchId: { $in: branchMatches } }] }
    ];
  }

  const [total, docs] = await Promise.all([
    ConversationModel.countDocuments(filter),
    ConversationModel.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
  ]);

  const [names, totals] = await Promise.all([
    branchNames(context.salonId, branchIds),
    countsFor(docs.map((d) => d._id), context)
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const items = docs.map((doc) =>
    conversationDto(doc as unknown as ConversationDoc, names.get(doc.branchId) || "", totals.count.get(String(doc._id)) ?? 0, totals.unread.get(String(doc._id)) ?? 0)
  );

  return {
    items,
    page: { page: pageNumber, pageSize, total, totalPages, hasMore: pageNumber < totalPages },
    metadata: { timezone, partial: false, unavailableSources: [] }
  };
}

/** Owner Console › Operations › Chat messages for one conversation. */
export async function ownerConversationMessages(context: Context, conversationId: string, branchId?: string): Promise<unknown> {
  const conversation = await assertOwnerConversationVisible(context, conversationId);
  const authorized = resolveAuthorizedBranchIds(context, branchId || "all");
  if (!authorized.includes(conversation.branchId)) throw ApiError.forbidden("The requested branch is not available to this account.");

  const docs = await ConversationMessageModel.find({ salonId: context.salonId, conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .limit(200);
  await ConversationMessageModel.updateMany(
    { conversationId: conversation._id, senderUserId: { $ne: context.userId } },
    { $inc: { deliveredCount: 1 } }
  );

  return {
    items: docs.map((doc) => messageDto(doc as unknown as ConversationMessage)),
    metadata: { timezone, partial: false, unavailableSources: [], branchId: conversation.branchId }
  };
}

/** Owner Console › Operations › Open (or re-open) a private conversation with a staff member. */
export async function createOwnerPrivateConversation(context: Context, branchId: string, staffId: string): Promise<unknown> {
  const branchIds = resolveAuthorizedBranchIds(context, branchId);
  const staff = await UserModel.findOne({ salonId: context.salonId, staffId });
  if (!staff) throw ApiError.notFound("Staff member was not found in your workspace.");
  if (!branchIds.includes(staff.branchId)) throw ApiError.forbidden("The staff member is not assigned to a branch available to this account.");

  const participants = [context.userId, String(staff._id)].sort();
  let conversation = await ConversationModel.findOne({
    salonId: context.salonId,
    branchId: staff.branchId,
    type: "private-owner",
    participantUserIds: participants
  });
  if (!conversation) {
    conversation = await ConversationModel.create({
      salonId: context.salonId,
      branchId: staff.branchId,
      type: "private-owner",
      title: `${context.user?.name || "Owner"} & ${staff.name}`,
      participantUserIds: participants
    });
    publishRealtimeEvent(context.salonId, "team-chat.conversation-created", {});
  }

  const [names, totals] = await Promise.all([
    branchNames(context.salonId, [conversation.branchId]),
    countsFor([conversation._id], context)
  ]);
  return conversationDto(
    conversation as unknown as ConversationDoc,
    names.get(conversation.branchId) || "",
    totals.count.get(String(conversation._id)) ?? 0,
    totals.unread.get(String(conversation._id)) ?? 0
  );
}

/** Owner Console › Operations › Send a message to a branch conversation. */
export async function sendOwnerConversationMessage(context: Context, conversationId: string, branchId: string, body: string): Promise<unknown> {
  const conversation = await assertOwnerConversationVisible(context, conversationId);
  const authorized = resolveAuthorizedBranchIds(context, branchId || "all");
  if (!authorized.includes(conversation.branchId)) throw ApiError.forbidden("The requested branch is not available to this account.");

  const created = await withTransaction(async (session) => {
    const [doc] = await ConversationMessageModel.create(
      [
        {
          salonId: context.salonId,
          conversationId: conversation._id,
          type: conversation.type,
          senderUserId: context.userId,
          senderName: context.user?.name || "",
          body,
          deliveredCount: 0,
          readCount: 0
        }
      ],
      { session }
    );
    await ConversationModel.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: doc!.createdAt ?? new Date() } }, { session });
    return doc!;
  });
  const payload = messageDto(created as unknown as ConversationMessage);
  publishRealtimeEvent(context.salonId, "staff-self.chat_message", { message: payload });
  return payload;
}

/** Owner Console › Operations › Acknowledge delivery/reads for messages the owner received. */
export async function updateOwnerConversationReceipts(
  context: Context,
  conversationId: string,
  branchId: string,
  messageIds: string[],
  status: "delivered" | "read"
): Promise<unknown> {
  const conversation = await assertOwnerConversationVisible(context, conversationId);
  const authorized = resolveAuthorizedBranchIds(context, branchId || "all");
  if (!authorized.includes(conversation.branchId)) throw ApiError.forbidden("The requested branch is not available to this account.");

  const ids = messageIds.filter((mid) => Types.ObjectId.isValid(mid));
  if (!ids.length) return { conversationId, receipts: [] };

  const docs = await ConversationMessageModel.find({ _id: { $in: ids }, conversationId: conversation._id });
  const field = status === "read" ? "readCount" : "deliveredCount";
  await ConversationMessageModel.updateMany(
    { _id: { $in: docs.map((d) => d._id) }, conversationId: conversation._id },
    { $inc: { [field]: 1 } }
  );

  const receipts = docs.map((doc) => ({
    messageId: String(doc._id),
    deliveredCount: doc.deliveredCount + (field === "deliveredCount" ? 1 : 0),
    readCount: doc.readCount + (field === "readCount" ? 1 : 0)
  }));
  publishRealtimeEvent(context.salonId, "team-chat.receipt-updated", { conversationId, receipts });
  return { conversationId, receipts };
}

/** Owner Console › Operations › Message-body search across authorized conversations (uses the shared text index). */
export async function searchOwnerConversationMessages(context: Context, q: string, branchId?: string, conversationId?: string): Promise<unknown> {
  const term = q.trim();
  if (!term) return { items: [], total: 0 };

  const branchIds = resolveAuthorizedBranchIds(context, branchId || "all");

  let convFilter: Record<string, unknown>;
  if (conversationId) {
    const conversation = await assertOwnerConversationVisible(context, conversationId);
    if (!branchIds.includes(conversation.branchId)) throw ApiError.forbidden("The requested branch is not available to this account.");
    convFilter = { conversationId: conversation._id };
  } else {
    const visible = await ConversationModel.find(visibilityFilter(context, branchIds));
    if (!visible.length) return { items: [], total: 0 };
    convFilter = { conversationId: { $in: visible.map((c) => c._id) } };
  }

  const docs = await ConversationMessageModel.find(
    { salonId: context.salonId, ...convFilter, $text: { $search: term } },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } } as { [key: string]: { $meta: "textScore" } })
    .limit(50);

  const conversations = await ConversationModel.find({
    salonId: context.salonId,
    _id: { $in: [...new Set(docs.map((d) => String(d.conversationId)))] }
  });
  const meta = new Map(conversations.map((c) => [String(c._id), { title: c.title, type: c.type, branchId: c.branchId }]));

  return {
    items: docs.map((doc) => ({
      id: String(doc._id),
      conversationId: String(doc.conversationId),
      conversationTitle: meta.get(String(doc.conversationId))?.title || "Conversation",
      conversationType: meta.get(String(doc.conversationId))?.type || "team",
      branchId: meta.get(String(doc.conversationId))?.branchId || context.branchId,
      senderUserId: doc.senderUserId,
      senderName: doc.senderName,
      body: doc.body,
      createdAt: iso(doc.createdAt)
    })),
    total: docs.length
  };
}