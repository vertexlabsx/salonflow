import type { Request } from "express";
import { ApiError } from "../../shared/http";
import { LeaveModel, type Leave } from "../../models/leave.model";
import { UserModel } from "../../models/user.model";
import { loadEnv } from "../../config/env";
import { businessDateIn } from "../../shared/business-date";

type Context = NonNullable<Request["context"]>;

export interface OwnerLeaveQuery {
  branchId?: string;
  from?: string;
  to?: string;
  view?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface OwnerLeaveDoc {
  _id: unknown;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  days: number;
  version?: number;
  decisionNote?: string;
  decidedBy?: string;
  decidedAt?: Date;
  createdAt?: Date;
}

function page(limit: number, offset: number, total: number) {
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { limit, offset, total, hasMore: nextOffset !== null, nextOffset };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function toOwnerLeave(doc: OwnerLeaveDoc, staff?: { name?: string; branchId?: string }): Record<string, unknown> {
  const version = doc.version ?? 1;
  const rejected = doc.status === "rejected";
  const approved = doc.status === "approved";
  return {
    id: String(doc._id),
    branchId: staff?.branchId || "",
    staffId: doc.staffId,
    staffName: staff?.name || doc.staffId,
    leaveType: doc.leaveType,
    startDate: doc.startDate,
    endDate: doc.endDate,
    days: doc.days,
    reason: doc.reason,
    status: doc.status,
    rejectionReason: rejected ? (doc.decisionNote || undefined) : undefined,
    approvedAt: approved ? iso(doc.decidedAt) || undefined : undefined,
    decisionNote: doc.decisionNote || "",
    documentAvailable: false,
    version
  };
}

async function staffLookup(salonId: string, staffIds: string[]): Promise<Map<string, { name: string; branchId: string }>> {
  const users = await UserModel.find({ salonId, staffId: { $in: staffIds.filter(Boolean) } });
  return new Map(users.map((u) => [u.staffId || String(u._id), { name: u.name, branchId: u.branchId }]));
}

async function toOwnerLeaves(context: Context, docs: OwnerLeaveDoc[]): Promise<Record<string, unknown>[]> {
  const staff = await staffLookup(context.salonId, docs.map((d) => d.staffId));
  return docs.map((d) => toOwnerLeave(d, staff.get(d.staffId)));
}

/** Owner leave management — the contract consumed by the Owner App People › Leave page. */
export async function listOwnerLeaves(context: Context, query: OwnerLeaveQuery): Promise<unknown> {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const filter: Record<string, unknown> = { salonId: context.salonId };

  const branchIds = Array.isArray(context.branchIds) ? [...context.branchIds] : [];
  const requestedBranch = query.branchId || "all";
  const scopedBranches = requestedBranch === "all" ? branchIds : [requestedBranch];
  if (scopedBranches.length) {
    const users = await UserModel.find({ salonId: context.salonId, staffId: { $ne: null }, branchId: { $in: scopedBranches } });
    filter.staffId = { $in: users.map((u) => u.staffId) };
  }

  if (query.from || query.to) {
    filter.startDate = { $lte: query.to || "9999-12-31" };
    filter.endDate = { $gte: query.from || "0000-01-01" };
  }

  const today = businessDateIn(loadEnv().SALON_TIMEZONE || "Asia/Kolkata");
  const view = query.view || "pending";
  if (view === "pending") filter.status = "pending";
  else if (view === "approved") filter.status = "approved";
  else if (view === "rejected") filter.status = "rejected";
  else if (view === "upcoming") {
    filter.status = { $in: ["pending", "approved"] };
    filter.startDate = { ...(typeof filter.startDate === "object" ? filter.startDate : {}), $gte: today };
  } else if (view === "past") {
    filter.endDate = { ...(typeof filter.endDate === "object" ? filter.endDate : {}), $lt: today };
  }

  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search) {
    const nameMatches = await UserModel.find({ salonId: context.salonId, staffId: { $ne: null }, name: new RegExp(escapeRegex(search), "i") });
    const ors: Record<string, unknown>[] = [
      { leaveType: new RegExp(escapeRegex(search), "i") },
      { reason: new RegExp(escapeRegex(search), "i") }
    ];
    if (nameMatches.length) ors.push({ staffId: { $in: nameMatches.map((u) => u.staffId) } });
    filter.$or = ors;
  }

  const [total, docs] = await Promise.all([
    LeaveModel.countDocuments(filter),
    LeaveModel.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit)
  ]);

  const items = await toOwnerLeaves(context, docs as OwnerLeaveDoc[]);
  return {
    items,
    page: page(limit, offset, total),
    availability: { documents: { available: false, reason: "Leave documents are not stored in this deployment." } },
    capabilities: { actions: ["decide"] },
    views: ["pending", "approved", "rejected", "upcoming", "past"],
    metadata: { timezone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata", supportedFilters: ["branchId", "from", "to", "view", "search"] }
  };
}

export async function ownerLeaveDetail(context: Context, id: string): Promise<unknown> {
  const doc = await LeaveModel.findById(id);
  if (!doc || doc.salonId !== context.salonId) throw ApiError.notFound("Leave request was not found in your workspace.");

  const [staff, balancesRows, conflicts] = await Promise.all([
    UserModel.findOne({ salonId: context.salonId, staffId: doc.staffId }),
    LeaveModel.aggregate([
      { $match: { salonId: context.salonId, staffId: doc.staffId, status: "approved" } },
      { $group: { _id: "$leaveType", used: { $sum: "$days" } } }
    ]),
    LeaveModel.find({
      salonId: context.salonId,
      staffId: doc.staffId,
      _id: { $ne: doc._id },
      status: "approved",
      startDate: { $lte: doc.endDate },
      endDate: { $gte: doc.startDate }
    })
  ]);

  const leave = toOwnerLeave(doc as OwnerLeaveDoc, staff ? { name: staff.name, branchId: staff.branchId } : undefined);
  const now = new Date().toISOString();
  const balances = balancesRows.map((row) => ({
    id: row._id,
    leaveType: row._id,
    openingBalance: 0,
    accrued: 0,
    used: Number(row.used) || 0,
    balance: 0,
    updatedAt: now
  }));
  const history = [
    { action: "requested", at: iso(doc.createdAt), by: staff?.name || doc.staffId },
    ...(doc.decidedAt && doc.decidedBy ? [{ action: doc.status === "approved" ? "approved" : "rejected", at: iso(doc.decidedAt), by: doc.decidedBy || "" }] : [])
  ];

  return {
    leave,
    balances,
    conflicts: conflicts.map((c) => toOwnerLeave(c as OwnerLeaveDoc, staff ? { name: staff.name, branchId: staff.branchId } : undefined)),
    history,
    availability: { documents: { available: false, reason: "Leave documents are not stored in this deployment." } },
    capabilities: { actions: doc.status === "pending" ? ["approve", "reject"] : [] }
  };
}

export async function decideOwnerLeave(
  context: Context,
  id: string,
  decision: "approve" | "reject",
  payload: { version?: number; reason?: string }
): Promise<unknown> {
  const doc = await LeaveModel.findById(id);
  if (!doc || doc.salonId !== context.salonId) throw ApiError.notFound("Leave request was not found in your workspace.");
  if (doc.status !== "pending") throw ApiError.conflict("This leave request was already decided.");

  const version = Number(payload.version) || (doc.version ?? 1);
  if (version !== (doc.version ?? 1)) throw ApiError.conflict("This request changed. Refresh and review it again.");

  const updated = await LeaveModel.findOneAndUpdate(
    { _id: doc._id, status: "pending", version: doc.version ?? 1 },
    {
      $set: {
        status: decision === "approve" ? "approved" : "rejected",
        decisionNote: String(payload.reason ?? "").trim().slice(0, 500),
        decidedBy: (context.user as { name?: string })?.name || String(context.userId),
        decidedAt: new Date(),
        version: (doc.version ?? 1) + 1
      }
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw ApiError.conflict("This request changed. Refresh and review it again.");

  const staff = await UserModel.findOne({ salonId: context.salonId, staffId: updated.staffId });
  return toOwnerLeave(updated as OwnerLeaveDoc, staff ? { name: staff.name, branchId: staff.branchId } : undefined);
}