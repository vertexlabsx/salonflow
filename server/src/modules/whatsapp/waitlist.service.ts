import { Types } from "mongoose";
import { AppointmentModel } from "../../models/appointment.model";
import { AppointmentSlotLockModel } from "../../models/appointment-slot-lock.model";
import { BranchModel } from "../../models/branch.model";
import { CustomerModel } from "../../models/customer.model";
import { WaitlistModel } from "../../models/waitlist.model";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { sendWhatsAppMessage } from "./whatsapp.service";

function slotInstants(startAt: Date, endAt: Date): Date[] {
  const slots: Date[] = [];
  for (let ts = startAt.getTime(); ts < endAt.getTime(); ts += 5 * 60_000) slots.push(new Date(ts));
  return slots.length ? slots : [startAt];
}

function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function minutes(label: string): number {
  const [hour, minute] = label.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function withinPreference(opened: string, preferred: string): boolean {
  if (!preferred) return true;
  return Math.abs(minutes(opened) - minutes(preferred)) <= 60;
}

export async function offerCancelledSlotToWaitlist(input: {
  salonId: string;
  branchId: string;
  staffId: string;
  serviceIds: string[];
  serviceNames: string[];
  startAt: Date;
  endAt: Date;
  value: number;
  durationMinutes: number;
}): Promise<{ offered: boolean; waitlistId?: string; appointmentId?: string }> {
  const branch = await BranchModel.findOne({ _id: input.branchId, salonId: input.salonId }).lean();
  const timezone = branch?.timezone || "Asia/Kolkata";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(input.startAt);
  const openedTime = localTime(input.startAt, timezone);
  const serviceIds = input.serviceIds.map(String);
  const candidates = await WaitlistModel.find({
    salonId: input.salonId,
    branchId: input.branchId,
    status: "waiting",
    notified: false,
    $or: [{ date: "" }, { date }],
    serviceIds: { $all: serviceIds }
  }).sort({ createdAt: 1 }).limit(20);
  const entry = candidates.find((item) => (!item.staffId || item.staffId === input.staffId) && withinPreference(openedTime, item.preferredTime || ""));
  if (!entry) return { offered: false };

  const appointmentId = new Types.ObjectId();
  try {
    await AppointmentSlotLockModel.create(slotInstants(input.startAt, input.endAt).map((slotAt) => ({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, appointmentId: String(appointmentId), slotAt })));
  } catch {
    return { offered: false };
  }

  const customer = await CustomerModel.findById(entry.customerId).lean();
  await AppointmentModel.create({
    _id: appointmentId,
    salonId: input.salonId,
    branchId: input.branchId,
    staffId: input.staffId,
    customerId: entry.customerId,
    customerName: customer?.name || entry.customerPhone,
    serviceIds,
    serviceNames: input.serviceNames,
    durationMinutes: input.durationMinutes,
    value: input.value,
    startAt: input.startAt,
    endAt: input.endAt,
    status: "pending",
    source: "whatsapp_waitlist",
    paymentStatus: "not_required",
    holdExpiresAt: new Date(Date.now() + 15 * 60_000)
  });
  await WaitlistModel.updateOne({ _id: entry._id }, { $set: { status: "offered", notified: true, offeredAppointmentId: String(appointmentId), opportunityExpiresAt: new Date(Date.now() + 15 * 60_000) } });
  publishRealtimeEvent(input.salonId, "appointment.created", { id: String(appointmentId), branchId: input.branchId, staffId: input.staffId, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), status: "pending", source: "whatsapp_waitlist" });
  await sendWhatsAppMessage({
    salonId: input.salonId,
    appointmentId: String(appointmentId),
    toPhone: entry.customerPhone,
    type: "waitlist",
    body: `A waitlist slot opened for ${input.serviceNames.join(", ")} at ${openedTime}. Reply BOOK within 15 minutes to claim it. Booking ID: ${String(appointmentId)}`,
    metadata: { source: "waitlist_cancel_match", waitlistId: String(entry._id), dedupeKey: `waitlist_cancel_match:${entry._id}:${appointmentId}` }
  });
  return { offered: true, waitlistId: String(entry._id), appointmentId: String(appointmentId) };
}
