import { Types } from "mongoose";
import { AppointmentModel } from "../../models/appointment.model";
import { BranchModel } from "../../models/branch.model";
import { LeaveModel } from "../../models/leave.model";
import { ScheduleModel } from "../../models/schedule.model";
import { ServiceModel } from "../../models/service.model";
import { UserModel } from "../../models/user.model";
import { ApiError } from "../../shared/http";

const BOOKING_BLOCKING_STATUSES = ["booked", "confirmed", "arrived", "in_service"];

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dateStringInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return (h === 24 ? 0 : h) * 60 + m;
}

export interface AvailabilityInput {
  salonId: string;
  branchId: string;
  serviceId: string;
  startAt: Date;
  preferredStaffId?: string;
}

export interface AvailabilityResult {
  service: { id: string; name: string; durationMinutes: number; pricePaise: number };
  staffId: string;
  endAt: Date;
}

export async function findAvailableStaff(input: AvailabilityInput): Promise<AvailabilityResult> {
  if (!Types.ObjectId.isValid(input.serviceId)) throw ApiError.badRequest("A valid service is required.");
  const service = await ServiceModel.findOne({ _id: input.serviceId, salonId: input.salonId, status: "active" });
  if (!service) throw ApiError.notFound("Service was not found.");
  if (service.branchIds.length && !service.branchIds.includes(input.branchId)) throw ApiError.badRequest("This service is not available at the selected branch.");

  const branch = await BranchModel.findOne({ _id: input.branchId, salonId: input.salonId, status: "active" });
  if (!branch) throw ApiError.notFound("Branch was not found.");
  const endAt = new Date(input.startAt.getTime() + service.durationMinutes * 60_000);
  const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: branch.timezone, weekday: "short" }).format(input.startAt) && input.startAt.getDay());
  const dayHours = branch.hours.find((h) => h.weekday === weekday);
  if (!dayHours || dayHours.closed) throw ApiError.conflict("The branch is closed on this date.");
  const startMinutes = localMinutes(input.startAt, branch.timezone);
  const endMinutes = localMinutes(endAt, branch.timezone);
  if (startMinutes < minutes(dayHours.open) || endMinutes > minutes(dayHours.close)) {
    throw ApiError.conflict("Requested time is outside branch working hours.");
  }

  const eligible = input.preferredStaffId ? [input.preferredStaffId] : service.eligibleStaffIds;
  const staffFilter = eligible.length ? { staffId: { $in: eligible } } : {};
  const staff = await UserModel.find({ salonId: input.salonId, branchIds: input.branchId, status: "active", ...staffFilter }).sort({ staffId: 1 });
  if (!staff.length) throw ApiError.conflict("No eligible staff is available for this service.");

  const date = dateStringInTz(input.startAt, branch.timezone);
  const loads = await Promise.all(
    staff.map(async (user) => {
      const staffId = user.staffId || String(user._id);
      const [schedule, leave, overlap, dayLoad] = await Promise.all([
        ScheduleModel.findOne({ salonId: input.salonId, branchId: input.branchId, staffId, scheduleDate: date, status: { $ne: "cancelled" } }),
        LeaveModel.findOne({ salonId: input.salonId, staffId, status: { $in: ["pending", "approved"] }, startDate: { $lte: date }, endDate: { $gte: date } }),
        AppointmentModel.findOne({
          salonId: input.salonId,
          staffId,
          status: { $in: BOOKING_BLOCKING_STATUSES },
          startAt: { $lt: endAt },
          endAt: { $gt: input.startAt }
        }),
        AppointmentModel.countDocuments({ salonId: input.salonId, staffId, startAt: { $gte: new Date(input.startAt.getTime() - 12 * 60 * 60_000), $lte: new Date(input.startAt.getTime() + 12 * 60 * 60_000) } })
      ]);
      if (!schedule || leave || overlap) return null;
      const shiftStart = minutes(schedule.startTime);
      const shiftEnd = minutes(schedule.endTime);
      if (startMinutes < shiftStart || endMinutes > shiftEnd) return null;
      return { staffId, load: dayLoad };
    })
  );

  const selected = loads.filter(Boolean).sort((a, b) => (a!.load - b!.load) || a!.staffId.localeCompare(b!.staffId))[0];
  if (!selected) throw ApiError.conflict("No staff is available for this time. Please choose another slot.");
  return { service: { id: String(service._id), name: service.name, durationMinutes: service.durationMinutes, pricePaise: service.pricePaise }, staffId: selected.staffId, endAt };
}

export { BOOKING_BLOCKING_STATUSES };
