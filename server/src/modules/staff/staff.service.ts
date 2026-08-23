import { Types } from "mongoose";
import { loadEnv, type Env } from "../../config/env";
import { AttendanceModel } from "../../models/attendance.model";
import { AppointmentModel } from "../../models/appointment.model";
import type { Request } from "express";
import { ApiError } from "../../shared/http";
import { businessDateIn, zonedDayRange } from "../../shared/business-date";
import { withTransaction } from "../../config/mongo";
import { requireContext } from "../../middleware/tenant-context";
import { toStaffAppointment, toStaffAttendance, type StaffAppointmentDto, type StaffAttendanceDto } from "./staff.types";

type Context = NonNullable<Request["context"]>;

const MAX_ATTENDANCE_LIMIT = 500;

function salonTimezone(env: Env = loadEnv()): string {
  return env.SALON_TIMEZONE || "Asia/Kolkata";
}

/* ── Attendance punches (transactional) ─────────────────────────────────── */

export async function clockIn(context: Context, source: string): Promise<StaffAttendanceDto> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  const now = new Date();
  const businessDate = businessDateIn(salonTimezone(), now);
  return withTransaction(async (session) => {
    const open = await AttendanceModel.findOne({ salonId: context.salonId, staffId: context.staffId, status: "open" }).session(session);
    if (open) throw ApiError.conflict("You are already checked in. Clock out before clocking in again.", { attendanceId: String(open._id) });
    const created = await AttendanceModel.create(
      [
        {
          salonId: context.salonId,
          staffId: context.staffId,
          businessDate,
          clockInAt: now,
          clockOutAt: null,
          status: "open",
          source
        }
      ],
      { session }
    );
    return toStaffAttendance(created[0]!);
  });
}

export async function clockOut(context: Context, attendanceId: string): Promise<StaffAttendanceDto> {
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  if (!Types.ObjectId.isValid(attendanceId)) throw ApiError.badRequest("A valid attendanceId is required.");
  return withTransaction(async (session) => {
    const closed = await AttendanceModel.findOneAndUpdate(
      { _id: attendanceId, salonId: context.salonId, staffId: context.staffId, status: "open" },
      { $set: { status: "closed", clockOutAt: new Date() } },
      { new: true, session }
    );
    if (!closed) {
      // Distinguish "never existed / not yours" from "already closed".
      const existing = await AttendanceModel.findOne({ _id: attendanceId, salonId: context.salonId, staffId: context.staffId }).session(session);
      if (!existing) throw ApiError.notFound("Attendance record was not found.");
      throw ApiError.conflict("This attendance record is already closed.");
    }
    return toStaffAttendance(closed);
  });
}

export async function listAttendance(
  context: Context,
  query: { date?: string; from?: string; to?: string; limit?: number }
): Promise<StaffAttendanceDto[]> {
  const filter: Record<string, unknown> = { salonId: context.salonId, staffId: context.staffId };
  if (query.date) {
    filter.businessDate = query.date;
  } else if (query.from || query.to) {
    filter.businessDate = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {})
    };
  }
  const limit = Math.min(Math.max(query.limit ?? MAX_ATTENDANCE_LIMIT, 1), MAX_ATTENDANCE_LIMIT);
  const docs = await AttendanceModel.find(filter).sort({ clockInAt: -1 }).limit(limit);
  return docs.map(toStaffAttendance);
}

/* ── Read models ────────────────────────────────────────────────────────── */

export async function staffToday(context: Context, date?: string): Promise<unknown> {
  const businessDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : businessDateIn(salonTimezone());
  const [attendanceDocs, tasks] = await Promise.all([
    AttendanceModel.find({ salonId: context.salonId, staffId: context.staffId, businessDate }).sort({ clockInAt: -1 }),
    import("./staff-os.service").then((mod) => mod.activeTasks(context))
  ]);
  let activeBreak: { id: string; status: string; startedAt?: string } | null = null;
  for (const doc of attendanceDocs) {
    const openBreak = doc.breaks.find((entry) => !entry.endedAt);
    if (openBreak) {
      activeBreak = { id: String(doc._id), status: "started", startedAt: openBreak.startedAt.toISOString() };
      break;
    }
  }
  return {
    date: businessDate,
    schedules: await import("./staff-self.service").then((mod) => mod.myCalendar(context)),
    attendance: attendanceDocs.map(toStaffAttendance),
    activeBreak,
    tasks
  };
}

export async function staffDashboard(context: Context): Promise<unknown> {
  const env = loadEnv();
  const tz = salonTimezone(env);
  const today = businessDateIn(tz);
  const { start, end } = zonedDayRange(tz, today);
  const now = new Date();

  const docs = await AppointmentModel.find({
    salonId: context.salonId,
    branchId: { $in: context.branchIds.length ? context.branchIds : [context.branchId] },
    startAt: { $gte: start, $lt: end },
    ...(context.staffId ? { staffId: context.staffId } : {})
  })
    .sort({ startAt: 1 })
    .limit(500);

  const appointments = docs.map(toStaffAppointment);
  const liveAppointments = appointments.filter((a) => {
    if (a.status === "in_service") return true;
    if (a.status !== "booked") return false;
    const startAt = new Date(a.startAt).getTime();
    const endAt = new Date(a.endAt).getTime();
    return startAt <= now.getTime() && now.getTime() < endAt;
  });
  const completed = appointments.filter((a) => a.status === "completed");
  const cancelled = appointments.filter((a) => a.status === "cancelled" || a.status === "no_show");
  const billable = appointments.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
  const appointmentValue = billable.reduce((sum, a) => sum + a.value, 0);

  const user = context.user;
  const fullName = user?.name || "";
  const nameParts = fullName.trim().split(/\s+/);
  const extras = (user ?? {}) as unknown as { mobile?: string };

  return {
    staff: {
      id: user?.staffId || context.userId,
      fullName,
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" "),
      mobile: extras.mobile || "",
      email: user?.email || "",
      roleId: user?.role || context.role,
      department: "",
      designation: user?.roleDisplayName || "",
      status: user?.status || "active"
    },
    summary: {
      appointments: billable.length,
      todayAppointments: appointments.length,
      liveAppointments: liveAppointments.length,
      completedAppointments: completed.length,
      cancelledAppointments: cancelled.length,
      salesCount: 0,
      revenue: 0,
      appointmentValue
    },
    todayAppointments: appointments,
    liveAppointments,
    workReport: completed,
    appointments,
    sales: []
  };
}

/** Guard for routes that require an actual staff profile attached to the login. */
export function requireStaffProfile(req: Request): Context {
  const context = requireContext(req);
  if (!context.staffId) throw ApiError.forbidden("This account has no staff profile attached.");
  return context;
}
