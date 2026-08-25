import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { loadEnv } from "../../config/env";
import { SalonModel } from "../../models/salon.model";
import { WhatsAppInboundModel } from "../../models/whatsapp-inbound.model";
import { WhatsAppBookingSessionModel } from "../../models/whatsapp-booking-session.model";
import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { CustomerModel } from "../../models/customer.model";
import { createAppointment } from "../appointments/appointment.service";
import { applyWhatsAppDeliveryStatus, sendWhatsAppMessage } from "./whatsapp.service";
import { zonedTimeToUtc } from "../../shared/business-date";
import { WhatsAppConnectionModel } from "../../models/whatsapp-connection.model";
import { WhatsAppWebhookEventModel } from "../../models/whatsapp-webhook-event.model";
import { embeddedSignupRouter } from "./meta/embedded-signup.routes";
import { extractReceptionistIntent } from "./ai-receptionist.service";

export const whatsappRouter = Router();
export const metaWebhookRouter = Router();

/* ── Meta webhook verification handshake ────────────────────────────────── */

function verifyWebhook(req: Request, res: Response): void {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const env = loadEnv();
  const expected = env.VERIFY_TOKEN || env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
}

whatsappRouter.get("/webhook", verifyWebhook);
metaWebhookRouter.get("/", verifyWebhook);

interface WaInboundMessage {
  phoneNumberId: string;
  waPhone: string;
  profileName: string;
  messageId: string;
  text: string;
  timestampMs: number;
}

interface WaDeliveryStatus {
  providerMessageId: string;
  status: string;
  timestampMs: number;
}

/** Extracts the first text message of a Meta webhook payload. */
function extractMessage(payload: unknown): WaInboundMessage | null {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }>;
        };
      }>;
    }>;
  };
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const message = value?.messages?.[0];
        if (!message || message.type !== "text") continue;
        return {
          phoneNumberId: value?.metadata?.phone_number_id ?? "",
          waPhone: message.from ?? "",
          profileName: value?.contacts?.[0]?.profile?.name ?? "",
          messageId: message.id ?? "",
          text: message.text?.body ?? "",
          timestampMs: message.timestamp ? Number(message.timestamp) * 1000 : Date.now()
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractStatuses(payload: unknown): WaDeliveryStatus[] {
  const body = payload as {
    entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string; timestamp?: string }> } }> }>;
  };
  const statuses: WaDeliveryStatus[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        statuses.push({ providerMessageId: status.id, status: status.status, timestampMs: status.timestamp ? Number(status.timestamp) * 1000 : Date.now() });
      }
    }
  }
  return statuses;
}

function verifyMetaSignature(rawBody: string, header: string | undefined, testBypass = false): boolean {
  const env = loadEnv();
  if (env.NODE_ENV !== "production" && testBypass) return true;
  if (env.NODE_ENV === "test" && !header) return true;
  const secret = env.META_WEBHOOK_APP_SECRET || env.META_APP_SECRET;
  if (!secret) return true; // mock provider / local dev
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice("sha256=".length));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const BOOKING_KEYWORDS = ["book", "book appointment", "appointment"];

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function sessionExpiry(): Date {
  return new Date(Date.now() + 30 * 60_000);
}

async function defaultBranchId(salonId: string): Promise<string> {
  const branch = await BranchModel.findOne({ salonId, status: "active" }).sort({ createdAt: 1 });
  return branch?._id || `${salonId}_main`;
}

function normalizeTimeInput(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const exact = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (exact) return `${exact[1]!.padStart(2, "0")}:${exact[2]}`;
  const meridiem = trimmed.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!meridiem) return value;
  let hour = Number(meridiem[1]);
  const minute = meridiem[2] || "00";
  if (meridiem[3] === "pm" && hour < 12) hour += 12;
  if (meridiem[3] === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function isPastBusinessDate(value: string): boolean {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).toLocaleDateString("en-CA");
  return value < today;
}

async function handleBookingMessage(salonId: string, branchId: string, message: WaInboundMessage): Promise<Record<string, unknown>> {
  const text = message.text.trim();
  const lower = text.toLowerCase();
  const ai = await extractReceptionistIntent(text);
  const phone = normalizePhone(message.waPhone);
  await CustomerModel.findOneAndUpdate(
    { salonId, normalizedPhone: phone },
    {
      $setOnInsert: { branchId, source: "whatsapp" },
      $set: {
        name: message.profileName || phone,
        whatsappPhoneNumberId: message.phoneNumberId,
        interactionStatus: "active"
      }
    },
    { upsert: true, new: true }
  );
  let session = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: phone });

  if (!session || session.expiresAt < new Date() || BOOKING_KEYWORDS.includes(lower)) {
    const hasBookingIntent = ai.intent === "BOOK_APPOINTMENT" || BOOKING_KEYWORDS.some((keyword) => lower === keyword || lower.includes(keyword)) || /hair|spa|skin|nail|makeup|beard|colour|color|service|price/.test(lower);
    if (!hasBookingIntent) {
      return { action: "ignored", reply: "Send 'Book appointment' to start booking." };
    }
    const services = await ServiceModel.find({ salonId, status: "active", $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }] }).limit(10);
    const matchedService = services.find((service) => service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId, waPhone: phone },
      {
        $set: {
          branchId,
          profileName: message.profileName,
          state: matchedService ? (ai.date ? "select_time" : "select_date") : "select_service",
          serviceId: matchedService ? String(matchedService._id) : null,
          serviceName: matchedService?.name || null,
          date: ai.date || null,
          startAt: null,
          staffId: null,
          customerName: message.profileName || "",
          expiresAt: sessionExpiry()
        }
      },
      { upsert: true, new: true }
    );
    if (!session) throw ApiError.badRequest("Unable to start booking session.");
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
    if (matchedService && ai.date && ai.time) return { action: "service_date_time_selected", state: session.state, reply: `I understood ${matchedService.name} on ${ai.date} around ${normalizeTimeInput(ai.time)}. Please send ${normalizeTimeInput(ai.time)} to check availability.` };
    if (matchedService && ai.date) return { action: "service_date_selected", state: session.state, reply: `${matchedService.name} selected for ${ai.date}. Please send time as HH:mm.` };
    if (matchedService) return { action: "service_selected", state: session.state, reply: `${matchedService.name} selected. Please send appointment date as YYYY-MM-DD.` };
    return { action: "booking_started", state: session.state, reply: `Which service would you like? ${services.map((s, i) => `${i + 1}. ${s.name}`).join(" ")}` };
  }

  if (session.state === "select_service") {
    const services = await ServiceModel.find({ salonId, status: "active", $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }] }).limit(10);
    const index = Number(text) - 1;
    const selected = services[index] || services.find((service) => service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    if (!selected) return { action: "needs_service", reply: "Please select a valid service number/name." };
    session.serviceId = String(selected._id);
    session.serviceName = selected.name;
    session.state = "select_date";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "service_selected", service: selected.name, reply: "Please send appointment date as YYYY-MM-DD." };
  }

  if (session.state === "select_date") {
    const dateInput = ai.date || text;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return { action: "needs_date", reply: "Please send date as YYYY-MM-DD." };
    if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
    session.date = dateInput;
    session.state = "select_time";
    session.expiresAt = sessionExpiry();
    await session.save();
    if (ai.time) return { action: "date_selected", date: dateInput, reply: `Please send ${normalizeTimeInput(ai.time)} to check availability.` };
    return { action: "date_selected", date: dateInput, reply: "Please send time as HH:mm (24-hour format)." };
  }

  if (session.state === "select_time") {
    const timeInput = normalizeTimeInput(ai.time || text);
    if (!/^\d{2}:\d{2}$/.test(timeInput)) return { action: "needs_time", reply: "Please send time as HH:mm." };
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const [hour, minute] = timeInput.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, session.date || "", hour || 0, minute || 0);
    if (Number.isNaN(startAt.getTime())) return { action: "needs_time", reply: "Invalid time. Please send time as HH:mm." };
    session.startAt = startAt;
    session.state = session.customerName ? "confirm" : "confirm_name";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "time_selected", reply: session.customerName ? `Confirm booking for ${session.serviceName} at ${timeInput}? Reply CONFIRM.` : "Please send your name." };
  }

  if (session.state === "confirm_name") {
    session.customerName = text.slice(0, 160);
    session.state = "confirm";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "name_selected", reply: `Confirm booking for ${session.serviceName} on ${session.date}? Reply CONFIRM.` };
  }

  if (session.state === "confirm") {
    if (lower !== "confirm") return { action: "needs_confirm", reply: "Reply CONFIRM to create appointment, or CANCEL to stop." };
    if (!session.serviceId || !session.startAt) return { action: "invalid_session", reply: "Booking session expired. Send 'Book appointment' again." };
    const appointment = await createAppointment({
      salonId,
      branchId: session.branchId,
      serviceId: session.serviceId,
      startAt: session.startAt,
      customerName: session.customerName || message.profileName || phone,
      normalizedPhone: phone,
      source: "whatsapp"
    });
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booked" } });
    session.state = "completed";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "appointment_created", appointment, reply: "Appointment booked. You will receive a reminder before your visit." };
  }

  return { action: "ignored", reply: "Send 'Book appointment' to start booking." };
}

/**
 * Inbound WhatsApp messages become bookings in the SAME unified list the owner
 * and staff already read — no other app involved.
 */
const receiveWebhook = asyncHandler(async (req, res) => {
    const rawBody = req.rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    if (!verifyMetaSignature(rawBody, req.header("x-hub-signature-256"), req.header("x-test-webhook") === "true")) throw ApiError.unauthorized("Invalid webhook signature.");

    const statuses = extractStatuses(req.body);
    if (statuses.length) {
      const results = await Promise.all(statuses.map((status) => applyWhatsAppDeliveryStatus(status.providerMessageId, status.status, status.timestampMs)));
      ok(res, { successHandled: true, statuses: statuses.length, matched: results.filter(Boolean).length });
      return;
    }

    const message = extractMessage(req.body);
    if (!message || !message.waPhone) {
      ok(res, { ignored: true });
      return;
    }

    // Route to the salon that owns this WhatsApp phone number (mock provider: first active salon).
    const env = loadEnv();
    const connection = message.phoneNumberId ? await WhatsAppConnectionModel.findOne({ phoneNumberId: message.phoneNumberId, status: "connected" }) : null;
    const salonId = connection?.salonId || (env.WHATSAPP_PROVIDER === "mock" ? (await SalonModel.findOne({ status: "active" }))?._id : null);
    if (!salonId) {
      ok(res, { ignored: true });
      return;
    }

    const eventId = message.messageId || `${message.phoneNumberId}:${message.waPhone}:${message.timestampMs}`;
    const insertedEvent = await WhatsAppWebhookEventModel.updateOne(
      { eventId },
      { $setOnInsert: { eventId, phoneNumberId: message.phoneNumberId, wabaId: connection?.wabaId || "", salonId: String(salonId), eventType: "message", payload: req.body, receivedAt: new Date(message.timestampMs), status: "received", retryCount: 0, error: "" } },
      { upsert: true }
    );
    if (insertedEvent.upsertedCount === 0) {
      ok(res, { successHandled: true, duplicated: true });
      return;
    }

    const duplicate = await WhatsAppInboundModel.findOne({ salonId: salonId, messageId: message.messageId });
    if (duplicate) {
      ok(res, { successHandled: true, duplicated: true, appointmentId: duplicate.appointmentId });
      return;
    }

    const branchId = await defaultBranchId(String(salonId));
    const result = await handleBookingMessage(String(salonId), branchId, message);
    if (result.reply) {
      await sendWhatsAppMessage({
        salonId: String(salonId),
        toPhone: normalizePhone(message.waPhone),
        type: "utility",
        body: String(result.reply),
        appointmentId: result.action === "appointment_created" ? String((result.appointment as { id?: string }).id || "") : null
      });
    }
    await WhatsAppInboundModel.create({
      salonId: salonId,
      waPhone: normalizePhone(message.waPhone),
      profileName: message.profileName,
      messageId: message.messageId,
      text: message.text,
      receivedAt: new Date(message.timestampMs),
      appointmentId: result.action === "appointment_created" ? String((result.appointment as { id?: string }).id || "") : null
    });
    await WhatsAppWebhookEventModel.updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } });

    ok(res, { successHandled: true, ...result });
  });

whatsappRouter.post("/webhook", receiveWebhook);
metaWebhookRouter.post("/", receiveWebhook);

whatsappRouter.use(embeddedSignupRouter);
