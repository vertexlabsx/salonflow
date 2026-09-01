import { Types } from "mongoose";
import type { Request } from "express";
import { ApiError } from "../../shared/http";
import { ScheduleModel } from "../../models/schedule.model";
import { ShiftSwapModel } from "../../models/shift-swap.model";
import { ChatThreadModel } from "../../models/chat-thread.model";
import { ChatMessageModel } from "../../models/chat-message.model";
import { ConversationModel } from "../../models/conversation.model";
import { ConversationMessageModel } from "../../models/conversation-message.model";
import { UserModel } from "../../models/user.model";
import { withTransaction } from "../../config/mongo";
import { publishRealtimeEvent } from "../../modules/realtime/realtime.service";
import { requireContext } from "../../middleware/tenant-context";
import { loadEnv } from "../../config/env";

type Context = NonNullable<Request["context"]>;

/* ── Workspace preferences ──────────────────────────────────────────────── */

export async function workspacePreferences(context: Context): Promise<unknown> {
  return {
    workspace: { workspaceName: context.salonId === "tenant_aura" ? "Solastio Studio - Flagship" : context.salonId },
    localization: { timezone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata", locale: "en-IN" },
    dateTime: { dateFormat: "DD MMM YYYY", timeFormat: "hh:mm A", businessDayStartHour: 6, weekStartsOn: "MONDAY" },
    interface: { compactMode: false },
    defaults: { staffHints: true }
  };
}

/* ── Calendar / schedules ───────────────────────────────────────────────── */

function scheduleDto(doc: {
  _id: unknown;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  status: string;
  version: number;
}): unknown {
  return {
    id: String(doc._id),
    date: doc.scheduleDate,
    startTime: doc.startTime,
    endTime: doc.endTime,
    type: doc.shiftType,
    status: doc.status,
    version: doc.version
  };
}

export async function myCalendar(context: Context): Promise<unknown[]> {
  const docs = await ScheduleModel.find({ salonId: context.salonId, staffId: context.staffId })
    .sort({ scheduleDate: -1 })
    .limit(60);
  return docs.map(scheduleDto);
}

export async function updateSchedule(
  context: Context,
  scheduleId: string,
  patch: { status?: string },
  version?: number
): Promise<unknown> {
  if (!Types.ObjectId.isValid(scheduleId)) throw ApiError.badRequest("A valid schedule id is required.");
  if (patch.status && !["scheduled", "confirmed", "completed", "cancelled", "leave"].includes(patch.status)) {
    throw ApiError.badRequest("Invalid schedule status.");
  }
  const filter: Record<string, unknown> = { _id: scheduleId, salonId: context.salonId, staffId: context.staffId };
  if (typeof version === "number") filter.version = version;
  const updated = await ScheduleModel.findOneAndUpdate(filter, { $set: patch, $inc: { version: 1 } }, { new: true });
  if (!updated) throw ApiError.staleVersion("This schedule entry changed on another device. Refresh and try again.");
  return scheduleDto(updated);
}

/* ── Shift swaps ────────────────────────────────────────────────────────── */

async function staffNames(salonId: string, staffIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(staffIds.filter(Boolean))];
  if (!unique.length) return map;
  const docs = await UserModel.find({ salonId, staffId: { $in: unique } }).select("staffId name");
  for (const doc of docs) if (doc.staffId) map.set(doc.staffId, doc.name);
  return map;
}

export async function swapCoworkers(context: Context): Promise<unknown[]> {
  const rows = await ScheduleModel.aggregate([
    { $match: { salonId: context.salonId, branchId: context.branchId } },
    { $group: { _id: "$staffId" } },
    { $match: { _id: { $ne: context.staffId || null } } },
    { $limit: 50 }
  ]);
  const ids = rows.map((row) => String(row._id));
  const names = await staffNames(context.salonId, ids);
  return ids.map((staffId) => ({ id: staffId, name: names.get(staffId) || staffId, branchId: context.branchId, designation: "" }));
}

function swapDto(
  doc: {
    _id: unknown;
    branchId: string;
    scheduleId: string;
    fromStaffId: string;
    toStaffId: string;
    scheduleDate: string;
    startTime: string;
    endTime: string;
    shiftType: string;
    reason: string;
    status: string;
    targetResponseNote: string;
    rejectionReason: string;
    version: number;
    createdAt?: Date;
    updatedAt?: Date;
  },
  names: Map<string, string>
): unknown {
  return {
    id: String(doc._id),
    branchId: doc.branchId,
    scheduleId: doc.scheduleId,
    fromStaffId: doc.fromStaffId,
    toStaffId: doc.toStaffId,
    fromStaffName: names.get(doc.fromStaffId) || doc.fromStaffId,
    toStaffName: names.get(doc.toStaffId) || doc.toStaffId,
    scheduleDate: doc.scheduleDate,
    startTime: doc.startTime,
    endTime: doc.endTime,
    shiftType: doc.shiftType,
    reason: doc.reason,
    status: doc.status,
    targetResponseNote: doc.targetResponseNote || undefined,
    rejectionReason: doc.rejectionReason || undefined,
    version: doc.version,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString()
  };
}

export async function listShiftSwaps(context: Context): Promise<unknown[]> {
  const docs = await ShiftSwapModel.find({
    salonId: context.salonId,
    $or: [{ fromStaffId: context.staffId }, { toStaffId: context.staffId }]
  })
    .sort({ createdAt: -1 })
    .limit(30);
  const names = await staffNames(context.salonId, docs.flatMap((d) => [d.fromStaffId, d.toStaffId]));
  return docs.map((doc) => swapDto(doc, names));
}

export async function createShiftSwap(
  context: Context,
  payload: { scheduleId: string; toStaffId: string; reason: string }
): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  if (payload.toStaffId === context.staffId) throw ApiError.badRequest("You cannot swap a shift with yourself.");
  return withTransaction(async (session) => {
    const schedule = await ScheduleModel.findOne({
      _id: payload.scheduleId,
      salonId: context.salonId,
      staffId: context.staffId
    }).session(session);
    if (!schedule) throw ApiError.notFound("Schedule entry was not found.");
    const open = await ShiftSwapModel.findOne({
      scheduleId: schedule._id,
      status: { $in: ["pending_staff", "pending_manager"] }
    }).session(session);
    if (open) throw ApiError.conflict("A swap request is already pending for this shift.");
    const created = await ShiftSwapModel.create(
      [
        {
          salonId: context.salonId,
          branchId: schedule.branchId,
          scheduleId: String(schedule._id),
          fromStaffId: context.staffId!,
          toStaffId: payload.toStaffId,
          scheduleDate: schedule.scheduleDate,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          shiftType: schedule.shiftType,
          reason: payload.reason,
          status: "pending_staff"
        }
      ],
      { session }
    );
    const names = await staffNames(context.salonId, [context.staffId!, payload.toStaffId]);
    return swapDto(created[0]!, names);
  });
}

/** Target staff accepts/declines a pending swap. */
export async function respondShiftSwap(
  context: Context,
  id: string,
  decision: "accept" | "decline",
  version: number,
  note: string
): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  return withTransaction(async (session) => {
    const updated = await ShiftSwapModel.findOneAndUpdate(
      { _id: id, salonId: context.salonId, toStaffId: context.staffId, status: "pending_staff", version },
      {
        $set: { status: decision === "accept" ? "pending_manager" : "declined", targetResponseNote: note },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!updated) {
      const existing = await ShiftSwapModel.findOne({ _id: id, salonId: context.salonId, toStaffId: context.staffId }).session(session);
      if (!existing) throw ApiError.notFound("Swap request was not found.");
      throw ApiError.staleVersion("This swap request changed. Refresh and try again.");
    }
    const names = await staffNames(context.salonId, [updated.fromStaffId, updated.toStaffId]);
    return swapDto(updated, names);
  });
}

/** Requester cancels their own pending swap. */
export async function cancelShiftSwap(context: Context, id: string, version: number): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  return withTransaction(async (session) => {
    const updated = await ShiftSwapModel.findOneAndUpdate(
      { _id: id, salonId: context.salonId, fromStaffId: context.staffId, status: { $in: ["pending_staff", "pending_manager"] }, version },
      { $set: { status: "cancelled" }, $inc: { version: 1 } },
      { new: true, session }
    );
    if (!updated) {
      const existing = await ShiftSwapModel.findOne({ _id: id, salonId: context.salonId, fromStaffId: context.staffId }).session(session);
      if (!existing) throw ApiError.notFound("Swap request was not found.");
      throw ApiError.staleVersion("This swap request changed. Refresh and try again.");
    }
    const names = await staffNames(context.salonId, [updated.fromStaffId, updated.toStaffId]);
    return swapDto(updated, names);
  });
}

/* ── Internal chat (staff-self) ─────────────────────────────────────────── */

export async function chatThreads(context: Context): Promise<unknown[]> {
  const branchIds = context.branchIds.length ? context.branchIds : [context.branchId];
  const existing = await ChatThreadModel.findOne({ salonId: context.salonId, branchId: context.branchId });
  if (!existing) {
    await ChatThreadModel.create({
      salonId: context.salonId,
      branchId: context.branchId,
      title: `${context.branchId} Team`,
      channel: "internal",
      createdByStaffId: null
    });
  }
  const docs = await ChatThreadModel.find({ salonId: context.salonId, branchId: { $in: branchIds } })
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .limit(30);
  const counts = await ChatMessageModel.aggregate([{ $match: { threadId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: "$threadId", count: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((row) => [String(row._id), Number(row.count)]));
  return docs.map((doc) => ({
    id: String(doc._id),
    tenantId: doc.salonId,
    branchId: doc.branchId,
    title: doc.title,
    channel: doc.channel,
    messageCount: countMap.get(String(doc._id)) ?? 0,
    lastMessageAt: doc.lastMessageAt ? doc.lastMessageAt.toISOString() : undefined
  }));
}

async function assertThreadMember(context: Context, threadId: string) {
  if (!Types.ObjectId.isValid(threadId)) throw ApiError.badRequest("A valid thread id is required.");
  const thread = await ChatThreadModel.findOne({ _id: threadId, salonId: context.salonId });
  if (!thread) throw ApiError.notFound("Chat thread was not found.");
  if (!context.branchIds.includes(thread.branchId)) throw ApiError.forbidden("This chat belongs to another branch.");
  return thread;
}

export async function chatMessages(context: Context, threadId: string): Promise<unknown[]> {
  const thread = await assertThreadMember(context, threadId);
  const docs = await ChatMessageModel.find({ salonId: context.salonId, threadId: thread._id }).sort({ createdAt: 1 }).limit(200);
  // Mark messages sent by others as read by me.
  await ChatMessageModel.updateMany(
    { threadId: thread._id, senderStaffId: { $ne: context.staffId }, readBy: { $ne: context.staffId } },
    { $push: { readBy: context.staffId } }
  );
  return docs.map((doc) => ({
    id: String(doc._id),
    threadId: String(doc.threadId),
    senderStaffId: doc.senderStaffId,
    senderName: doc.senderName,
    body: doc.body,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    readByJson: JSON.stringify(doc.readBy)
  }));
}

export async function sendChatMessage(context: Context, threadId: string, body: string): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  const thread = await assertThreadMember(context, threadId);
  return withTransaction(async (session) => {
    const created = await ChatMessageModel.create(
      [
        {
          salonId: context.salonId,
          threadId: thread._id,
          senderStaffId: context.staffId,
          senderName: context.user?.name || "",
          body
        }
      ],
      { session }
    );
    await ChatThreadModel.updateOne({ _id: thread._id }, { $set: { lastMessageAt: new Date() } }, { session });
    const doc = created[0]!;
    return {
      id: String(doc._id),
      threadId: String(doc.threadId),
      senderStaffId: doc.senderStaffId,
      senderName: doc.senderName,
      body: doc.body,
      createdAt: (doc.createdAt ?? new Date()).toISOString(),
      readByJson: JSON.stringify([])
    };
  });
}

/* ── Team chat (conversations) ──────────────────────────────────────────── */

async function ensureTeamConversation(context: Context) {
  const existing = await ConversationModel.findOne({ salonId: context.salonId, branchId: context.branchId, type: "team" });
  if (existing) return existing;
  return ConversationModel.create({
    salonId: context.salonId,
    branchId: context.branchId,
    type: "team",
    title: `${context.salonId} Team`,
    participantUserIds: []
  });
}

export async function conversations(context: Context): Promise<unknown[]> {
  await ensureTeamConversation(context);
  const docs = await ConversationModel.find({
    salonId: context.salonId,
    branchId: { $in: context.branchIds.length ? context.branchIds : [context.branchId] },
    $or: [{ type: "team" }, { type: "private-owner", participantUserIds: context.userId }]
  }).sort({ updatedAt: -1 });
  const counts = await ConversationMessageModel.aggregate([
    { $match: { conversationId: { $in: docs.map((d) => d._id) } } },
    { $group: { _id: "$conversationId", count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), Number(row.count)]));
  return docs.map((doc) => ({
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    branchId: doc.branchId,
    participantUserIds: doc.participantUserIds.length ? [...doc.participantUserIds] : null,
    messageCount: countMap.get(String(doc._id)) ?? 0,
    lastMessageAt: doc.lastMessageAt ? doc.lastMessageAt.toISOString() : null,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString()
  }));
}

async function assertConversationVisible(context: Context, conversationId: string) {
  if (!Types.ObjectId.isValid(conversationId)) throw ApiError.badRequest("A valid conversation id is required.");
  const conversation = await ConversationModel.findOne({ _id: conversationId, salonId: context.salonId });
  if (!conversation) throw ApiError.notFound("Conversation was not found.");
  const visible = conversation.type === "team" || conversation.participantUserIds.includes(context.userId);
  if (!visible) throw ApiError.notFound("Conversation was not found in your workspace.");
  return conversation;
}

export async function conversationMessages(context: Context, conversationId: string): Promise<unknown[]> {
  const conversation = await assertConversationVisible(context, conversationId);
  const docs = await ConversationMessageModel.find({ salonId: context.salonId, conversationId: conversation._id })
    .sort({ createdAt: 1 })
    .limit(200);
  await ConversationMessageModel.updateMany(
    { conversationId: conversation._id, senderUserId: { $ne: context.userId } },
    { $inc: { deliveredCount: 1 } }
  );
  return docs.map((doc) => ({
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    type: doc.type,
    senderUserId: doc.senderUserId,
    senderName: doc.senderName,
    body: doc.body,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    receipt: { deliveredCount: doc.deliveredCount, readCount: doc.readCount }
  }));
}

export async function updateReceipts(context: Context, conversationId: string, messageIds: string[], status: string): Promise<void> {
  const conversation = await assertConversationVisible(context, conversationId);
  const field = status === "read" ? "readCount" : "deliveredCount";
  await ConversationMessageModel.updateMany(
    { _id: { $in: messageIds.filter((mid) => Types.ObjectId.isValid(mid)) }, conversationId: conversation._id },
    { $inc: { [field]: 1 } }
  );
}

/** Persists a team/private-owner conversation message and broadcasts it over realtime. */
export async function sendConversationMessage(context: Context, conversationId: string, body: string): Promise<unknown> {
  const conversation = await assertConversationVisible(context, conversationId);
  const message = await withTransaction(async (session) => {
    const [created] = await ConversationMessageModel.create(
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
    await ConversationModel.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: created.createdAt ?? new Date() } }, { session });
    return created!;
  });
  const payload = {
    id: String(message._id),
    conversationId: String(message.conversationId),
    type: message.type,
    senderUserId: message.senderUserId,
    senderName: message.senderName,
    body: message.body,
    createdAt: (message.createdAt ?? new Date()).toISOString(),
    receipt: { deliveredCount: message.deliveredCount, readCount: message.readCount }
  };
  publishRealtimeEvent(context.salonId, "staff-self.chat_message", { message: payload });
  return payload;
}

/** Server-side message search across every conversation visible to the caller. */
export async function searchConversationMessages(context: Context, q: string, conversationId?: string): Promise<unknown> {
  const term = q.trim();
  if (!term) return { items: [], total: 0 };

  const branchIds = context.branchIds.length ? context.branchIds : [context.branchId];
  const visibleFilter: Record<string, unknown> = {
    salonId: context.salonId,
    branchId: { $in: branchIds },
    $or: [{ type: "team" }, { type: "private-owner", participantUserIds: context.userId }]
  };

  let convFilter: Record<string, unknown> = {};
  if (conversationId) {
    const conversation = await assertConversationVisible(context, conversationId);
    convFilter = { conversationId: conversation._id };
  } else {
    const visible = await ConversationModel.find(visibleFilter);
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
      createdAt: (doc.createdAt ?? new Date()).toISOString()
    })),
    total: docs.length
  };
}
