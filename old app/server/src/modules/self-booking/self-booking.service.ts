import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { UserModel } from "../../models/user.model";
import { AppointmentModel } from "../../models/appointment.model";
import { CustomerModel } from "../../models/customer.model";
import { findAvailableStaff } from "../appointments/availability.service";
import { createAppointment, cancelAppointmentForCustomer, rescheduleAppointmentForCustomer } from "../appointments/appointment.service";
import { applyDepositToAppointment } from "../whatsapp/deposit.service";
import { sendWhatsAppMessage } from "../whatsapp/whatsapp.service";
import { businessDateIn, zonedTimeToUtc, zonedWeekday } from "../../shared/business-date";
import { ApiError } from "../../shared/http";

function money(paise: number): string {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return (h === 24 ? 0 : h) * 60 + m;
}

function fmtDateTime(date: Date, timezone: string): string {
  return date.toLocaleString("en-IN", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function fmtDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-IN", { timeZone: timezone, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

async function assertSalonScope(salonId: string) {
  if (!salonId) throw ApiError.badRequest("salonId is required.");
}

async function branchFor(salonId: string, branchId: string) {
  const branch = await BranchModel.findOne({ _id: branchId, salonId, status: "active" }).lean();
  if (!branch) throw ApiError.notFound("Branch was not found or is unavailable.");
  return branch;
}

async function serviceFor(salonId: string, branchId: string, serviceId: string) {
  const service = await ServiceModel.findOne({ _id: serviceId, salonId, status: "active" }).lean();
  if (!service) throw ApiError.notFound("Service was not found.");
  if (service.branchIds.length && !service.branchIds.includes(branchId)) throw ApiError.badRequest("This service is not available at the selected branch.");
  return service;
}

export async function listPublicBranches(salonId: string) {
  await assertSalonScope(salonId);
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ name: 1 }).lean();
  return branches.map((b) => ({
    id: String(b._id),
    name: b.name,
    timezone: b.timezone || "Asia/Kolkata"
  }));
}

export async function listPublicServices(salonId: string, branchId: string) {
  await assertSalonScope(salonId);
  if (!branchId) throw ApiError.badRequest("branchId is required.");
  const filter: Record<string, unknown> = { salonId, status: "active" };
  filter.$or = [{ branchIds: branchId }, { branchIds: { $size: 0 } }];
  const services = await ServiceModel.find(filter).sort({ name: 1 }).lean();
  return services.map((s) => ({
    id: String(s._id),
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    pricePaise: s.pricePaise,
    eligibleStaffIds: (s.eligibleStaffIds || []).map(String)
  }));
}

export async function listPublicStaff(salonId: string, branchId: string, serviceId?: string) {
  await assertSalonScope(salonId);
  if (!branchId) throw ApiError.badRequest("branchId is required.");
  const eligible: string[] | undefined = serviceId ? (await listPublicServices(salonId, branchId)).find((s) => s.id === serviceId)?.eligibleStaffIds : undefined;
  const filter: Record<string, unknown> = { salonId, branchIds: branchId, status: "active" };
  if (eligible?.length) filter.staffId = { $in: eligible };
  const users = await UserModel.find(filter).sort({ name: 1 }).lean();
  return users.filter((u) => u.staffId).map((u) => ({ staffId: String(u.staffId!), name: u.name }));
}

/**
 * List ONLY genuinely available slots for a service, date (and optional staff).
 * Each candidate slot is validated against real availability (staff shift,
 * schedule, leave, overlap, slot locks) — unavailable slots are simply omitted.
 */
export async function listAvailableSlots(input: { salonId: string; branchId: string; serviceId: string; date: string; staffId?: string; maxSlots?: number }) {
  await assertSalonScope(input.salonId);
  const branch = await branchFor(input.salonId, input.branchId);
  const service = await serviceFor(input.salonId, input.branchId, input.serviceId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw ApiError.badRequest("Date must be YYYY-MM-DD.");
  const timezone = branch.timezone || "Asia/Kolkata";
  const weekday = zonedWeekday(timezone, input.date);
  const dayHours = branch.hours.find((h) => h.weekday === weekday && !h.closed);
  if (!dayHours) return { date: input.date, slots: [] };

  const interval = Math.max(5, branch.slotIntervalMinutes || 15);
  const today = businessDateIn(timezone);
  const nowMin = today === input.date ? localMinutes(new Date(), timezone) + interval : minutes(dayHours.open);
  const firstMin = Math.max(minutes(dayHours.open), Math.ceil(nowMin / interval) * interval);
  const slots: Array<{ startAt: string; staffId: string; endAt: string }> = [];

  for (let slotMin = firstMin; slotMin + service.durationMinutes <= minutes(dayHours.close); slotMin += interval) {
    if (input.maxSlots && slots.length >= input.maxSlots) break;
    const hh = Math.floor(slotMin / 60);
    const mm = slotMin % 60;
    const startAt = zonedTimeToUtc(timezone, input.date, hh, mm);
    try {
      const available = await findAvailableStaff({
        salonId: input.salonId,
        branchId: input.branchId,
        serviceId: input.serviceId,
        startAt,
        preferredStaffId: input.staffId
      });
      slots.push({ startAt: startAt.toISOString(), staffId: available.staffId, endAt: available.endAt.toISOString() });
    } catch {
      // unavailable slot — omit
    }
  }
  return { date: input.date, slots };
}

/** Generate the next N bookable dates for a service (earliest-first, only dates that actually have slots). */
export async function nextAvailableDates(input: { salonId: string; branchId: string; serviceId: string; fromDate?: string; count?: number }) {
  await assertSalonScope(input.salonId);
  const branch = await branchFor(input.salonId, input.branchId);
  await serviceFor(input.salonId, input.branchId, input.serviceId);
  const timezone = branch.timezone || "Asia/Kolkata";
  const count = Math.min(Math.max(1, input.count || 7), 14);
  const from = input.fromDate || businessDateIn(timezone);
  const cursor = new Date(`${from}T12:00:00`);
  const dates: Array<{ date: string; slotCount: number }> = [];
  for (let i = 0; i < 30 && dates.length < count; i += 1) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const weekday = zonedWeekday(timezone, dateStr);
    const dayHours = branch.hours.find((h) => h.weekday === weekday && !h.closed);
    if (dayHours) {
      const listed = await listAvailableSlots({ salonId: input.salonId, branchId: input.branchId, serviceId: input.serviceId, date: dateStr, maxSlots: 24 });
      if (listed.slots.length) dates.push({ date: dateStr, slotCount: listed.slots.length });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function staffName(salonId: string, staffId: string): Promise<string> {
  const user = await UserModel.findOne({ salonId, staffId }).lean();
  return user?.name || "assigned staff";
}

async function buildSummary(salonId: string, branchId: string, staffId: string, serviceId: string, startAt: Date, durationMinutes: number, value: number, bookingId: string) {
  const branch = await branchFor(salonId, branchId);
  const service = await serviceFor(salonId, branchId, serviceId);
  const timezone = branch.timezone || "Asia/Kolkata";
  const name = await staffName(salonId, staffId);
  const lines = [
    `Booking ID: ${bookingId}`,
    `Service: ${service.name}`,
    `Staff: ${name}`,
    `Branch: ${branch.name}`,
    `Date & time: ${fmtDateTime(startAt, timezone)}`,
    `Duration: ${durationMinutes} min`,
    `Amount: ${money(value)}`,
    "Status: Confirmed"
  ];
  return { text: lines.join("\n"), branch, timezone };
}

export async function bookAppointment(input: {
  salonId: string;
  branchId: string;
  serviceId: string;
  startAt: string;
  customerName: string;
  phone: string;
  preferredStaffId?: string;
}) {
  await assertSalonScope(input.salonId);
  const branch = await branchFor(input.salonId, input.branchId);
  await serviceFor(input.salonId, input.branchId, input.serviceId);
  const phone = normalizePhone(input.phone);
  if (!phone) throw ApiError.badRequest("A valid phone number is required.");
  const name = (input.customerName || "").trim();
  if (!name) throw ApiError.badRequest("Customer name is required.");
  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw ApiError.badRequest("startAt must be a valid date.");
  if (startAt.getTime() < Date.now() - 60_000) throw ApiError.badRequest("Cannot book a time in the past.");

  const appointment = await createAppointment({
    salonId: input.salonId,
    branchId: input.branchId,
    serviceId: input.serviceId,
    startAt,
    customerName: name,
    normalizedPhone: phone,
    source: "whatsapp",
    preferredStaffId: input.preferredStaffId
  });

  const timezone = branch.timezone || "Asia/Kolkata";
  const summary = await buildSummary(input.salonId, input.branchId, appointment.staffId, input.serviceId, startAt, appointment.durationMinutes, appointment.value, appointment.id);

  const deposit = await applyDepositToAppointment({ salonId: input.salonId, branchId: input.branchId, appointmentId: appointment.id, valuePaise: appointment.value, customerName: name, customerPhone: phone });
  if (deposit.applied) {
    await sendWhatsAppMessage({
      salonId: input.salonId,
      appointmentId: appointment.id,
      toPhone: phone,
      type: "deposit",
      body: `Your slot is held while you pay the advance deposit:\n${summary.text}\n\nPay ${money(deposit.depositPaise)} here: ${deposit.paymentLink}\nThe slot releases in 30 minutes if unpaid.`
    });
  } else {
    await sendWhatsAppMessage({
      salonId: input.salonId,
      appointmentId: appointment.id,
      toPhone: phone,
      type: "confirmation",
      body: `Your appointment is confirmed.\n${summary.text}\n\nWant to change or cancel later? Reply RESCHEDULE or CANCEL on WhatsApp.\n(Call ${branch.name} for anything else.)`,
      metadata: { salonId: input.salonId, branchId: input.branchId, serviceId: input.serviceId, startAt: startAt.toISOString() }
    });
  }

  return {
    bookingId: appointment.id,
    staffId: appointment.staffId,
    serviceId: input.serviceId,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: deposit.applied ? "pending" : appointment.status,
    depositApplied: deposit.applied,
    paymentLink: deposit.paymentLink,
    timezone,
    branchName: branch.name
  };
}

async function findAppointmentForPhone(salonId: string, appointmentId: string, phone: string) {
  const appointment = await AppointmentModel.findOne({ _id: appointmentId, salonId }).lean();
  if (!appointment) throw ApiError.notFound("Appointment was not found.");
  if (appointment.customerId) {
    const customer = await CustomerModel.findById(appointment.customerId).lean();
    if (customer && customer.normalizedPhone !== normalizePhone(phone)) throw ApiError.forbidden("This booking does not belong to the provided phone number.");
  }
  return appointment;
}

export async function cancelBooking(input: { salonId: string; appointmentId: string; phone: string }) {
  await assertSalonScope(input.salonId);
  const phone = normalizePhone(input.phone);
  const appointment = await findAppointmentForPhone(input.salonId, input.appointmentId, phone);
  const updated = await cancelAppointmentForCustomer(input.salonId, input.appointmentId);
  await sendWhatsAppMessage({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    toPhone: phone,
    type: "cancellation",
    body: `Your booking (${updated.serviceNames.join(", ") || "appointment"}) on ${fmtDateTime(new Date(updated.startAt), "Asia/Kolkata")} has been cancelled. Refunds, if applicable, follow salon policy.`
  });
  return { bookingId: input.appointmentId, status: "cancelled", previousStartAt: new Date(appointment.startAt).toISOString() };
}

export async function rescheduleBooking(input: { salonId: string; appointmentId: string; phone: string; branchId?: string; newStartAt: string; serviceId?: string }) {
  await assertSalonScope(input.salonId);
  const phone = normalizePhone(input.phone);
  const appointment = await findAppointmentForPhone(input.salonId, input.appointmentId, phone);
  const branchId = input.branchId || String(appointment.branchId);
  const serviceId = input.serviceId || (appointment.serviceIds[0] ? String(appointment.serviceIds[0]) : "");
  if (!serviceId) throw ApiError.badRequest("Could not determine the service to reschedule.");
  await serviceFor(input.salonId, branchId, serviceId);
  const branch = await branchFor(input.salonId, branchId);
  const newStartAt = new Date(input.newStartAt);
  if (Number.isNaN(newStartAt.getTime())) throw ApiError.badRequest("newStartAt must be a valid date.");
  if (newStartAt.getTime() < Date.now() - 60_000) throw ApiError.badRequest("Cannot reschedule to a time in the past.");

  const next = await rescheduleAppointmentForCustomer({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    branchId,
    staffId: appointment.staffId,
    serviceIds: appointment.serviceIds.map(String),
    serviceNames: appointment.serviceNames,
    durationMinutes: appointment.durationMinutes,
    value: appointment.value,
    startAt: newStartAt,
    endAt: new Date(newStartAt.getTime() + appointment.durationMinutes * 60_000)
  });

  const summary = await buildSummary(input.salonId, branchId, next.staffId, serviceId, newStartAt, next.durationMinutes, next.value, next.id);
  await sendWhatsAppMessage({
    salonId: input.salonId,
    appointmentId: next.id,
    toPhone: phone,
    type: "reschedule",
    body: `Your appointment has been rescheduled.\n${summary.text}\n\nReply RESCHEDULE or CANCEL on WhatsApp to change it again.`
  });
  return { bookingId: next.id, status: "confirmed", newStartAt: next.startAt, timezone: branch.timezone || "Asia/Kolkata" };
}
