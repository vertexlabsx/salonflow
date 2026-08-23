import type { AppointmentDocument } from "../../models/appointment.model";
import type { AttendanceDocument } from "../../models/attendance.model";

/**
 * Wire contracts consumed by the Staff App (StaffAppService types). Field names
 * and shapes are frozen — the frontend renders them verbatim.
 */

export interface StaffAppointmentDto {
  id: string;
  staffId: string;
  branchId: string;
  serviceIds: string[];
  serviceNames: string[];
  durationMinutes: number;
  value: number;
  startAt: string;
  endAt: string;
  status: string;
  chair: string;
  source: string;
}

export interface StaffAttendanceDto {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string;
  status: string;
  source: string;
  overtimeMinutes: number;
  grossMinutes: number;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  scheduledShiftMinutes: number | null;
  overtimeCalculationStatus: string;
  overtimeReviewReason: string;
  overtimePolicyVersion: string;
  expectedEndAt: string;
  overtimeEnabled: boolean;
}

export function toStaffAppointment(doc: AppointmentDocument): StaffAppointmentDto {
  return {
    id: String(doc._id),
    staffId: doc.staffId,
    branchId: doc.branchId,
    serviceIds: [...(doc.serviceIds || [])],
    serviceNames: [...(doc.serviceNames || [])],
    durationMinutes: doc.durationMinutes,
    value: doc.value,
    startAt: doc.startAt.toISOString(),
    endAt: doc.endAt.toISOString(),
    status: doc.status,
    chair: doc.chair || "",
    source: doc.source || ""
  };
}

export function toStaffAttendance(doc: AttendanceDocument): StaffAttendanceDto {
  const end = doc.clockOutAt ? doc.clockOutAt.getTime() : Date.now();
  const grossMinutes = Math.max(0, Math.round((end - doc.clockInAt.getTime()) / 60_000));
  return {
    id: String(doc._id),
    businessDate: doc.businessDate,
    clockInAt: doc.clockInAt.toISOString(),
    clockOutAt: doc.clockOutAt ? doc.clockOutAt.toISOString() : "",
    status: doc.status,
    source: doc.source || "",
    overtimeMinutes: 0,
    grossMinutes,
    totalBreakMinutes: 0,
    totalWorkedMinutes: Math.max(0, grossMinutes),
    scheduledShiftMinutes: null,
    overtimeCalculationStatus: "not_applicable",
    overtimeReviewReason: "",
    overtimePolicyVersion: "v0",
    expectedEndAt: "",
    overtimeEnabled: false
  };
}
