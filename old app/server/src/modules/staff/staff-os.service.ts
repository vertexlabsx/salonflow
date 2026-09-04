import { Types } from "mongoose";
import type { Request } from "express";
import { ApiError } from "../../shared/http";
import { LeaveModel } from "../../models/leave.model";
import { TaskModel } from "../../models/task.model";
import { PayrollItemModel } from "../../models/payroll-item.model";
import { TargetModel } from "../../models/target.model";
import { AttendanceModel } from "../../models/attendance.model";
import { NotificationModel } from "../../models/notification.model";
import { withTransaction } from "../../config/mongo";
import { requireContext } from "../../middleware/tenant-context";
import { businessDateIn } from "../../shared/business-date";
import { loadEnv } from "../../config/env";

type Context = NonNullable<Request["context"]>;

export function toLeaveDto(doc: { _id: unknown; leaveType: string; startDate: string; endDate: string; reason: string; status: string; days: number; createdAt?: Date }): unknown {
  return {
    id: String(doc._id),
    leaveType: doc.leaveType,
    startDate: doc.startDate,
    endDate: doc.endDate,
    reason: doc.reason,
    status: doc.status,
    days: doc.days,
    createdAt: (doc.createdAt ?? new Date()).toISOString()
  };
}

function countDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000)) + 1;
}

/* ── Leaves ─────────────────────────────────────────────────────────────── */

export async function listLeaves(context: Context, limit: number): Promise<unknown[]> {
  const docs = await LeaveModel.find({ salonId: context.salonId, staffId: context.staffId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 50));
  return docs.map(toLeaveDto);
}

export async function requestLeave(
  context: Context,
  payload: { leaveType: string; startDate: string; endDate: string; reason: string }
): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  const days = countDays(payload.startDate, payload.endDate);
  if (days <= 0) throw ApiError.badRequest("End date must be on or after start date.");
  const created = await LeaveModel.create({
    salonId: context.salonId,
    staffId: context.staffId,
    leaveType: payload.leaveType,
    startDate: payload.startDate,
    endDate: payload.endDate,
    reason: payload.reason,
    status: "pending",
    days
  });
  return toLeaveDto(created);
}

/* ── Breaks (transactional punch extensions) ────────────────────────────── */

export async function startBreak(context: Context, breakType: string): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  return withTransaction(async (session) => {
    const updated = await AttendanceModel.findOneAndUpdate(
      {
        salonId: context.salonId,
        staffId: context.staffId,
        status: "open",
        breaks: { $not: { $elemMatch: { endedAt: null } } }
      },
      { $push: { breaks: { breakType, startedAt: new Date(), endedAt: null } } },
      { new: true, session }
    );
    if (!updated) {
      const open = await AttendanceModel.findOne({ salonId: context.salonId, staffId: context.staffId, status: "open" }).session(session);
      throw ApiError.conflict(open ? "A break is already running." : "Clock in before starting a break.");
    }
    return { id: String(updated._id), status: "break_started", startedAt: updated.breaks[updated.breaks.length - 1]?.startedAt };
  });
}

export async function endBreak(context: Context): Promise<unknown> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  return withTransaction(async (session) => {
    const open = await AttendanceModel.findOne({
      salonId: context.salonId,
      staffId: context.staffId,
      status: "open",
      breaks: { $elemMatch: { endedAt: null } }
    }).session(session);
    if (!open) throw ApiError.conflict("No break is currently running.");
    open.breaks.forEach((entry) => {
      if (!entry.endedAt) entry.endedAt = new Date();
    });
    await open.save();
    const last = open.breaks[open.breaks.length - 1];
    return { id: String(open._id), status: "break_ended", startedAt: last?.startedAt, endedAt: last?.endedAt };
  });
}

/* ── Overtime summary ───────────────────────────────────────────────────── */

function addDays(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function overtimeSummary(context: Context, asOf?: string): Promise<unknown> {
  const today = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : businessDateIn(loadEnv().SALON_TIMEZONE || "Asia/Kolkata");
  const weekStart = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = addDays(today, -29);

  const rows = await AttendanceModel.aggregate([
    { $match: { salonId: context.salonId, staffId: context.staffId, businessDate: { $gte: monthStart, $lte: today } } },
    { $group: { _id: "$businessDate", minutes: { $sum: "$grossMinutes" } } }
  ]);

  let todayMinutes = 0;
  let weekMinutes = 0;
  let last30DaysMinutes = 0;
  let lifetimeMinutes = 0;
  for (const row of rows) {
    const date = row._id as string;
    const minutes = Number(row.minutes) || 0;
    lifetimeMinutes += minutes;
    if (date === today) todayMinutes = minutes;
    if (date >= weekStart && date <= today) weekMinutes += minutes;
    if (date >= monthStart && date <= today) last30DaysMinutes += minutes;
  }

  return {
    asOf: today,
    weekStart,
    weekEnd: today,
    last30DaysStart: monthStart,
    todayMinutes,
    weekMinutes,
    last30DaysMinutes,
    lifetimeMinutes
  };
}

/* ── Payroll & targets ──────────────────────────────────────────────────── */

export async function listPayroll(context: Context): Promise<unknown[]> {
  const docs = await PayrollItemModel.find({ salonId: context.salonId, staffId: context.staffId }).sort({ createdAt: -1 }).limit(24);
  return docs.map((doc) => ({
    id: String(doc._id),
    payrollRunId: doc.payrollRunId,
    periodStart: doc.periodStart ?? undefined,
    periodEnd: doc.periodEnd ?? undefined,
    moneyStorageUnit: "paise" as const,
    sourceMoneyStorageUnit: "paise" as const,
    payrollContractVersion: 2 as const,
    grossAmountPaise: doc.grossAmountPaise,
    overtimeAmountPaise: doc.overtimeAmountPaise,
    bonusAmountPaise: doc.bonusAmountPaise,
    deductionAmountPaise: doc.deductionAmountPaise,
    netAmountPaise: doc.netAmountPaise,
    overtimeMinutes: doc.overtimeMinutes,
    status: doc.status,
    createdAt: (doc.createdAt ?? new Date()).toISOString()
  }));
}

export async function listTargets(context: Context): Promise<unknown[]> {
  const docs = await TargetModel.find({
    salonId: context.salonId,
    $or: [{ staffId: context.staffId }, { staffId: null }]
  })
    .sort({ endsOn: -1 })
    .limit(20);
  return docs.map((doc) => ({
    id: String(doc._id),
    targetName: doc.targetName,
    targetType: doc.targetType,
    targetValue: doc.targetValuePaise,
    achievedValue: doc.achievedValuePaise,
    status: doc.status,
    createdAt: (doc.createdAt ?? new Date()).toISOString()
  }));
}

/* ── Tasks ──────────────────────────────────────────────────────────────── */

const TASK_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

export async function updateTask(context: Context, taskId: string, status: string, version: number): Promise<void> {
  if (!Types.ObjectId.isValid(taskId)) throw ApiError.badRequest("A valid task id is required.");
  if (!TASK_STATUSES.has(status)) throw ApiError.badRequest("Invalid task status.");
  const filter: Record<string, unknown> = {
    _id: taskId,
    salonId: context.salonId,
    ...(context.staffId ? { $or: [{ staffId: context.staffId }, { staffId: null }] } : {})
  };
  const updated = await TaskModel.findOneAndUpdate({ ...filter, version }, { $set: { status }, $inc: { version: 1 } }, { new: true });
  if (!updated) throw ApiError.staleVersion("This task was changed by someone else. Refresh and try again.");
}

export async function activeTasks(context: Context): Promise<unknown[]> {
  const docs = await TaskModel.find({
    salonId: context.salonId,
    status: { $in: ["pending", "in_progress"] },
    ...(context.staffId ? { $or: [{ staffId: context.staffId }, { staffId: null }] } : {})
  })
    .sort({ dueAt: 1, createdAt: -1 })
    .limit(50);
  return docs.map((doc) => ({
    id: String(doc._id),
    title: doc.title,
    description: doc.description,
    status: doc.status,
    priority: doc.priority,
    dueAt: doc.dueAt ? doc.dueAt.toISOString() : "",
    assignedBy: doc.assignedBy,
    checklist: [],
    version: doc.version
  }));
}

/* ── Notifications ──────────────────────────────────────────────────────── */

export async function recentNotifications(context: Context, limit = 10): Promise<unknown[]> {
  const docs = await NotificationModel.find({
    salonId: context.salonId,
    $or: [{ staffId: context.staffId }, { staffId: null }]
  })
    .sort({ createdAt: -1 })
    .limit(limit);
  return docs.map((doc) => ({
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    status: doc.status,
    createdAt: (doc.createdAt ?? new Date()).toISOString()
  }));
}

export async function updateNotificationStatus(context: Context, notificationId: string, status: string): Promise<void> {
  if (!Types.ObjectId.isValid(notificationId)) throw ApiError.badRequest("A valid notification id is required.");
  if (!["read", "unread", "archived"].includes(status)) throw ApiError.badRequest("Invalid notification status.");
  const updated = await NotificationModel.updateOne(
    { _id: notificationId, salonId: context.salonId, $or: [{ staffId: context.staffId }, { staffId: null }] },
    { $set: { status } }
  );
  if (updated.matchedCount === 0) throw ApiError.notFound("Notification was not found.");
}
