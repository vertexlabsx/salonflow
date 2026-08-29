import { AppointmentModel, type AppointmentStatus } from "../../models/appointment.model";
import { AppointmentSlotLockModel } from "../../models/appointment-slot-lock.model";
import { CustomerModel } from "../../models/customer.model";
import { withTransaction } from "../../config/mongo";
import { ApiError } from "../../shared/http";
import { toStaffAppointment } from "../staff/staff.types";
import { BOOKING_BLOCKING_STATUSES, findAvailableStaff } from "./availability.service";
import { sendWhatsAppMessage } from "../whatsapp/whatsapp.service";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { notifyStaffByStaffId } from "../push/push.service";
import type { StaffAppointmentDto } from "../staff/staff.types";
import { Types } from "mongoose";

export interface CreateAppointmentInput {
  salonId: string;
  branchId: string;
  serviceId: string;
  startAt: Date;
  customerName: string;
  normalizedPhone?: string;
  source: "crm" | "walk_in" | "whatsapp";
  preferredStaffId?: string;
}

function slotInstants(startAt: Date, endAt: Date): Date[] {
  const slots: Date[] = [];
  const intervalMs = 5 * 60_000;
  const first = Math.floor(startAt.getTime() / intervalMs) * intervalMs;
  for (let ts = first; ts < endAt.getTime(); ts += intervalMs) {
    if (ts >= startAt.getTime()) slots.push(new Date(ts));
  }
  return slots.length ? slots : [startAt];
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<StaffAppointmentDto> {
  const availability = await findAvailableStaff({
    salonId: input.salonId,
    branchId: input.branchId,
    serviceId: input.serviceId,
    startAt: input.startAt,
    preferredStaffId: input.preferredStaffId
  });

  return withTransaction(async (session) => {
    const appointmentId = new Types.ObjectId();
    const overlap = await AppointmentModel.findOne({
      salonId: input.salonId,
      staffId: availability.staffId,
      status: { $in: BOOKING_BLOCKING_STATUSES },
      startAt: { $lt: availability.endAt },
      endAt: { $gt: input.startAt }
    }).session(session);
    if (overlap) {
      throw ApiError.conflict("Requested time is not available.", {
        conflicts: [{ id: String(overlap._id), startAt: overlap.startAt.toISOString(), endAt: overlap.endAt.toISOString(), staffId: overlap.staffId }]
      });
    }

    try {
      await AppointmentSlotLockModel.create(
        slotInstants(input.startAt, availability.endAt).map((slotAt) => ({ salonId: input.salonId, branchId: input.branchId, staffId: availability.staffId, appointmentId: String(appointmentId), slotAt })),
        { session, ordered: true }
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw ApiError.conflict("Requested time is not available.", { conflicts: [{ startAt: input.startAt.toISOString(), endAt: availability.endAt.toISOString(), staffId: availability.staffId }] });
      }
      throw error;
    }

    let customerId: string | undefined;
    if (input.normalizedPhone) {
      const customer = await CustomerModel.findOneAndUpdate(
        { salonId: input.salonId, normalizedPhone: input.normalizedPhone },
        { $setOnInsert: { branchId: input.branchId, source: input.source }, $set: { name: input.customerName, interactionStatus: input.source === "whatsapp" ? "booked" : "active" } },
        { upsert: true, new: true, session }
      );
      customerId = String(customer._id);
    }

    const rows = await AppointmentModel.create(
      [
        {
          _id: appointmentId,
          salonId: input.salonId,
          branchId: input.branchId,
          staffId: availability.staffId,
          customerId,
          customerName: input.customerName,
          serviceIds: [availability.service.id],
          serviceNames: [availability.service.name],
          durationMinutes: availability.service.durationMinutes,
          value: availability.service.pricePaise,
          startAt: input.startAt,
          endAt: availability.endAt,
          status: "booked",
          source: input.source
        }
      ],
      { session }
    );
    const appointment = rows[0]!;
    publishRealtimeEvent(input.salonId, "appointment.created", { id: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, startAt: appointment.startAt.toISOString(), endAt: appointment.endAt.toISOString(), status: appointment.status, source: appointment.source });
    void notifyStaffByStaffId(input.salonId, appointment.staffId, {
      title: "New appointment",
      body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      tag: `appointment-${String(appointment._id)}`,
      data: { appointmentId: String(appointment._id), type: "appointment.created" }
    });
    if (input.source === "whatsapp" && input.normalizedPhone) {
      await sendWhatsAppMessage({
        salonId: input.salonId,
        appointmentId: String(appointment._id),
        toPhone: input.normalizedPhone,
        type: "confirmation",
        body: `Your appointment for ${availability.service.name} is booked for ${input.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`
      });
      appointment.whatsappConfirmationSentAt = new Date();
      await appointment.save({ session });
    }
    return toStaffAppointment(appointment);
  });
}

export async function transitionAppointment(salonId: string, id: string, status: AppointmentStatus, version: number): Promise<StaffAppointmentDto> {
  const updated = await withTransaction(async (session) => {
    const appointment = await AppointmentModel.findOneAndUpdate(
      { _id: id, salonId, version },
      { $set: { status }, $inc: { version: 1 } },
      { new: true, session }
    );
    if (appointment && status === "cancelled") await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: id }).session(session);
    return appointment;
  });
  if (!updated) {
    const existing = await AppointmentModel.findOne({ _id: id, salonId });
    if (!existing) throw ApiError.notFound("Appointment was not found.");
    throw ApiError.staleVersion("This appointment changed elsewhere. Refresh the list and try again.");
  }
  publishRealtimeEvent(salonId, "appointment.status_changed", { id: String(updated._id), branchId: updated.branchId, staffId: updated.staffId, startAt: updated.startAt.toISOString(), endAt: updated.endAt.toISOString(), status: updated.status });
  void notifyStaffByStaffId(salonId, updated.staffId, {
    title: "Appointment updated",
    body: `${updated.customerName} is now ${updated.status.replace("_", " ")}`,
    tag: `appointment-${String(updated._id)}`,
    data: { appointmentId: String(updated._id), type: "appointment.status_changed", status: updated.status }
  });
  if ((status === "cancelled" || status === "confirmed") && updated.customerId) {
    const customer = await CustomerModel.findById(updated.customerId);
    if (customer?.normalizedPhone) {
      await sendWhatsAppMessage({
        salonId,
        appointmentId: String(updated._id),
        toPhone: customer.normalizedPhone,
        type: status === "cancelled" ? "cancellation" : "utility",
        body: status === "cancelled" ? "Your appointment has been cancelled." : "Your appointment is confirmed."
      });
    }
  }
  return toStaffAppointment(updated);
}

export interface CustomerBookingChange {
  salonId: string;
  appointmentId: string;
  branchId: string;
  staffId: string;
  serviceIds: string[];
  serviceNames: string[];
  durationMinutes: number;
  value: number;
  startAt: Date;
  endAt: Date;
}

/** Customer-initiated cancellation. Releases slot locks so the slot reopens for others. */
export async function cancelAppointmentForCustomer(salonId: string, appointmentId: string, customerId?: string): Promise<StaffAppointmentDto> {
  const updated = await withTransaction(async (session) => {
    const appointment = await AppointmentModel.findOneAndUpdate(
      { _id: appointmentId, salonId, status: { $in: BOOKING_BLOCKING_STATUSES } },
      { $set: { status: "cancelled" }, $inc: { version: 1 } },
      { new: true, session }
    );
    if (!appointment) throw ApiError.notFound("Appointment was not found.");
    await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId }).session(session);
    if (customerId) {
      await CustomerModel.updateOne({ _id: customerId, salonId }, { $set: { interactionStatus: "cancelled" } }).session(session);
    }
    return appointment;
  });
  publishRealtimeEvent(salonId, "appointment.status_changed", { id: String(updated._id), branchId: updated.branchId, staffId: updated.staffId, startAt: updated.startAt.toISOString(), endAt: updated.endAt.toISOString(), status: updated.status });
  void notifyStaffByStaffId(salonId, updated.staffId, {
    title: "Appointment cancelled",
    body: `${updated.customerName} cancelled ${updated.serviceNames.join(", ")}`,
    tag: `appointment-${String(updated._id)}`,
    data: { appointmentId: String(updated._id), type: "appointment.status_changed", status: updated.status }
  });
  return toStaffAppointment(updated);
}

/** Customer-initiated MODIFY: swaps services/staff/branch/time while keeping the appointment identity (single active appointment). */
export async function updateAppointmentForCustomer(input: CustomerBookingChange): Promise<StaffAppointmentDto> {
  const updated = await withTransaction(async (session) => {
    const overlap = await AppointmentModel.findOne({
      salonId: input.salonId,
      staffId: input.staffId,
      _id: { $ne: input.appointmentId },
      status: { $in: BOOKING_BLOCKING_STATUSES },
      startAt: { $lt: input.endAt },
      endAt: { $gt: input.startAt }
    }).session(session);
    if (overlap) {
      throw ApiError.conflict("Requested time is not available.", {
        conflicts: [{ id: String(overlap._id), startAt: overlap.startAt.toISOString(), endAt: overlap.endAt.toISOString(), staffId: overlap.staffId }]
      });
    }
    const appointment = await AppointmentModel.findOneAndUpdate(
      { _id: input.appointmentId, salonId: input.salonId },
      {
        $set: {
          branchId: input.branchId,
          staffId: input.staffId,
          serviceIds: input.serviceIds,
          serviceNames: input.serviceNames,
          durationMinutes: input.durationMinutes,
          value: input.value,
          startAt: input.startAt,
          endAt: input.endAt,
          status: "confirmed"
        },
        $inc: { version: 1 }
      },
      { new: true, session }
    );
    if (!appointment) throw ApiError.notFound("Appointment was not found.");
    try {
      await AppointmentSlotLockModel.deleteMany({ salonId: input.salonId, appointmentId: input.appointmentId }).session(session);
      await AppointmentSlotLockModel.create(
        slotInstants(input.startAt, input.endAt).map((slotAt) => ({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, appointmentId: input.appointmentId, slotAt })),
        { session, ordered: true }
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw ApiError.conflict("Requested time is not available.", { conflicts: [{ startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), staffId: input.staffId }] });
      }
      throw error;
    }
    return appointment;
  });
  publishRealtimeEvent(input.salonId, "appointment.changed", { id: String(updated._id), branchId: updated.branchId, staffId: updated.staffId, startAt: updated.startAt.toISOString(), endAt: updated.endAt.toISOString(), status: updated.status });
  void notifyStaffByStaffId(input.salonId, updated.staffId, {
    title: "Appointment updated",
    body: `${updated.customerName} — ${updated.serviceNames.join(", ")} on ${updated.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    tag: `appointment-${String(updated._id)}`,
    data: { appointmentId: String(updated._id), type: "appointment.changed", status: updated.status }
  });
  return toStaffAppointment(updated);
}

/**
 * Customer-initiated RESCHEDULE: creates a NEW appointment (status confirmed,
 * rescheduledFromId = old.id) and marks the OLD appointment as "rescheduled"
 * (rescheduledToId = new.id). There is never more than one active/confirmed
 * appointment for the pair, and the old record stays in history pointing at
 * the new one.
 */
export async function rescheduleAppointmentForCustomer(input: CustomerBookingChange): Promise<StaffAppointmentDto> {
  const result = await withTransaction(async (session) => {
    const original = await AppointmentModel.findOne({ _id: input.appointmentId, salonId: input.salonId }).session(session);
    if (!original) throw ApiError.notFound("Appointment was not found.");
    const overlap = await AppointmentModel.findOne({
      salonId: input.salonId,
      staffId: input.staffId,
      _id: { $ne: input.appointmentId },
      status: { $in: BOOKING_BLOCKING_STATUSES },
      startAt: { $lt: input.endAt },
      endAt: { $gt: input.startAt }
    }).session(session);
    if (overlap) {
      throw ApiError.conflict("Requested time is not available.", {
        conflicts: [{ id: String(overlap._id), startAt: overlap.startAt.toISOString(), endAt: overlap.endAt.toISOString(), staffId: overlap.staffId }]
      });
    }
    const newId = new Types.ObjectId();
    try {
      await AppointmentSlotLockModel.create(
        slotInstants(input.startAt, input.endAt).map((slotAt) => ({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, appointmentId: String(newId), slotAt })),
        { session, ordered: true }
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw ApiError.conflict("Requested time is not available.", { conflicts: [{ startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), staffId: input.staffId }] });
      }
      throw error;
    }
    const rows = await AppointmentModel.create(
      [
        {
          _id: newId,
          salonId: input.salonId,
          branchId: input.branchId,
          staffId: input.staffId,
          customerId: original.customerId,
          customerName: original.customerName,
          serviceIds: input.serviceIds,
          serviceNames: input.serviceNames,
          durationMinutes: input.durationMinutes,
          value: input.value,
          startAt: input.startAt,
          endAt: input.endAt,
          status: "confirmed",
          source: original.source || "whatsapp",
          rescheduledFromId: String(original._id)
        }
      ],
      { session }
    );
    if (original.status !== "rescheduled") {
      original.status = "rescheduled";
      original.rescheduledToId = String(newId);
      original.version += 1;
      await original.save({ session });
      await AppointmentSlotLockModel.deleteMany({ salonId: input.salonId, appointmentId: String(original._id) }).session(session);
    }
    return { next: rows[0]!, previous: original };
  });

  const next = result.next;
  publishRealtimeEvent(input.salonId, "appointment.created", { id: String(next._id), branchId: next.branchId, staffId: next.staffId, startAt: next.startAt.toISOString(), endAt: next.endAt.toISOString(), status: next.status, source: next.source });
  void notifyStaffByStaffId(input.salonId, next.staffId, {
    title: "New appointment (reschedule)",
    body: `${next.customerName} — ${next.serviceNames.join(", ")} on ${next.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    tag: `appointment-${String(next._id)}`,
    data: { appointmentId: String(next._id), type: "appointment.created", status: next.status, rescheduledFromId: String(result.previous._id) }
  });
  publishRealtimeEvent(input.salonId, "appointment.status_changed", { id: String(result.previous._id), branchId: result.previous.branchId, staffId: result.previous.staffId, startAt: result.previous.startAt.toISOString(), endAt: result.previous.endAt.toISOString(), status: "rescheduled", rescheduledToId: String(next._id) });
  if (String(result.previous.staffId) !== String(next.staffId)) {
    void notifyStaffByStaffId(input.salonId, String(result.previous.staffId), {
      title: "Appointment rescheduled",
      body: `${result.previous.customerName} moved this booking to another slot/staff`,
      tag: `appointment-${String(result.previous._id)}`,
      data: { appointmentId: String(result.previous._id), type: "appointment.status_changed", status: "rescheduled" }
    });
  }
  return toStaffAppointment(next);
}
