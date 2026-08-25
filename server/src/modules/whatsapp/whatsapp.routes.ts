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
import { findAvailableStaff } from "../appointments/availability.service";
import { applyWhatsAppDeliveryStatus, sendWhatsAppMessage } from "./whatsapp.service";
import { zonedTimeToUtc } from "../../shared/business-date";
import { WhatsAppConnectionModel } from "../../models/whatsapp-connection.model";
import { WhatsAppWebhookEventModel } from "../../models/whatsapp-webhook-event.model";
import { embeddedSignupRouter } from "./meta/embedded-signup.routes";
import { AppointmentModel } from "../../models/appointment.model";
import { AppointmentSlotLockModel } from "../../models/appointment-slot-lock.model";
import { OwnerSettingsModel } from "../../models/owner-settings.model";
import { createRazorpayPaymentLink, verifyRazorpayWebhook } from "../payments/razorpay.service";
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
          messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } } }>;
        };
      }>;
    }>;
  };
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const message = value?.messages?.[0];
        if (!message || (message.type !== "text" && message.type !== "interactive")) continue;
        const interactiveText = message.interactive?.button_reply?.title || message.interactive?.button_reply?.id || message.interactive?.list_reply?.title || message.interactive?.list_reply?.id || "";
        return {
          phoneNumberId: value?.metadata?.phone_number_id ?? "",
          waPhone: message.from ?? "",
          profileName: value?.contacts?.[0]?.profile?.name ?? "",
          messageId: message.id ?? "",
          text: message.text?.body ?? interactiveText,
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

const BOOKING_KEYWORDS = ["hi", "hello", "book", "book appointment", "appointment", "i want to book", "need appointment"];

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

function money(paise: number): string {
  return `₹${Math.round(paise / 100)}`;
}

function branchServiceFilter(salonId: string, branchId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { salonId, status: "active", $or: [{ branchIds: branchId }, { branchIds: { $size: 0 } }], ...extra };
}

function formatOptions(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
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

function parseUserDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function displayDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function clarifyReply(aiReply?: string, language?: string): string {
  if (aiReply?.trim()) return aiReply.trim();
  return language?.startsWith("hi") ? "Maaf kijiye, main aapki baat samajh nahi paya. Appointment book karne ke liye service aur time batayein." : "Sorry, I could not understand that. Please tell me the salon service and preferred time to book an appointment.";
}

async function depositFor(salonId: string, branchId: string, pricePaise: number): Promise<number> {
  void salonId;
  void branchId;
  return Math.min(pricePaise, 10000);
}

async function unusedConfigurableDepositFor(salonId: string, branchId: string, pricePaise: number): Promise<number> {
  const settings = await OwnerSettingsModel.findOne({ salonId, branchId }).lean() || await OwnerSettingsModel.findOne({ salonId, branchId: "" }).lean();
  const deposit = (settings?.settings as { bookingDeposit?: { mode?: string; amountPaise?: number; percent?: number; minimumPaise?: number } } | undefined)?.bookingDeposit;
  if (!deposit || deposit.mode === "none") return 0;
  if (deposit.mode === "fixed") return Math.min(pricePaise, Math.max(0, deposit.amountPaise || 0));
  const percent = deposit.percent ?? 10;
  const calculated = Math.ceil((pricePaise * percent) / 100);
  return Math.min(pricePaise, Math.max(calculated, deposit.minimumPaise || 0));
}

function listInteractive(body: string, button: string, rows: Array<{ id: string; title: string; description?: string }>): Record<string, unknown> | null {
  if (!rows.length || rows.length > 10) return null;
  return { type: "list", body: { text: body }, action: { button, sections: [{ title: button, rows }] } };
}

function slotInstants(startAt: Date, endAt: Date): Date[] {
  const slots: Date[] = [];
  for (let ts = startAt.getTime(); ts < endAt.getTime(); ts += 5 * 60_000) slots.push(new Date(ts));
  return slots.length ? slots : [startAt];
}

async function expireCustomerHolds(salonId: string, branchId: string, customerId: string): Promise<void> {
  const holds = await AppointmentModel.find({ salonId, branchId, customerId, status: "pending" });
  for (const hold of holds) {
    hold.status = "expired";
    await hold.save();
    await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: String(hold._id) });
  }
}

async function handleBookingMessage(salonId: string, branchId: string, message: WaInboundMessage): Promise<Record<string, unknown>> {
  const text = message.text.trim();
  const lower = text.toLowerCase();
  const ai = await extractReceptionistIntent(text);
  const phone = normalizePhone(message.waPhone);
  const customer = await CustomerModel.findOneAndUpdate(
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
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 });
  const branchMatch = branches.find((branch) => branch.name.toLowerCase() === lower || lower.includes(branch.name.toLowerCase()));

  if (lower === "reschedule" || ai.intent === "RESCHEDULE_APPOINTMENT") {
    const upcoming = await AppointmentModel.find({ salonId, customerId: String(customer._id), status: { $in: ["booked", "confirmed"] }, startAt: { $gte: new Date() } }).sort({ startAt: 1 }).limit(5);
    if (!upcoming.length) return { action: "no_appointment", reply: "I could not find an upcoming appointment to reschedule for this WhatsApp number." };
    const appointment = upcoming[0]!;
    if (!/^\d{2}:\d{2}$/.test(text) && !ai.time) {
      session = await WhatsAppBookingSessionModel.findOneAndUpdate({ salonId, waPhone: phone }, { $set: { branchId: appointment.branchId, serviceId: appointment.serviceIds[0] || null, serviceName: appointment.serviceNames[0] || null, holdAppointmentId: String(appointment._id), state: "select_time", date: ai.date || appointment.startAt.toISOString().slice(0, 10), expiresAt: sessionExpiry() } }, { upsert: true, new: true });
      return { action: "needs_reschedule_time", reply: "What new time would you prefer? Send HH:mm." };
    }
  }

  if (lower === "cancel" || lower.includes("cancel my appointment") || ai.intent === "CANCEL_APPOINTMENT") {
    const upcoming = await AppointmentModel.find({ salonId, customerId: String(customer._id), status: { $in: ["pending", "booked", "confirmed"] }, startAt: { $gte: new Date() } }).sort({ startAt: 1 }).limit(5);
    if (!upcoming.length) return { action: "no_appointment", reply: "I could not find an upcoming appointment for this WhatsApp number." };
    if (upcoming.length > 1 && lower !== "cancel") return { action: "choose_cancel", reply: `Which appointment should I cancel?\n${formatOptions(upcoming.map((item) => `${item.serviceNames.join(", ")} at ${item.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`))}` };
    const appointment = upcoming[0]!;
    appointment.status = "cancelled";
    appointment.paymentStatus = appointment.paymentStatus === "paid" ? "paid" : "failed";
    await appointment.save();
    await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: String(appointment._id) });
    if (session) {
      session.state = "cancelled";
      session.expiresAt = sessionExpiry();
      await session.save();
    }
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "cancelled" } });
    return { action: "appointment_cancelled", appointmentId: String(appointment._id), reply: "Your appointment has been cancelled. Refunds, if applicable, follow the salon policy." };
  }

  if (!session || session.expiresAt < new Date() || BOOKING_KEYWORDS.includes(lower)) {
    const hasBookingIntent = ai.isSalonRelated !== false && (ai.intent === "BOOK_APPOINTMENT" || ai.intent === "SERVICES" || ai.intent === "PRICES" || BOOKING_KEYWORDS.some((keyword) => lower === keyword || lower.includes(keyword)) || /hair|spa|skin|nail|makeup|beard|colour|color|service|price|baal|kaat|kat|salon/.test(lower));
    if (!hasBookingIntent) {
      return { action: "clarify", reply: clarifyReply(ai.reply, ai.language) };
    }
    const aiBranchMatch = ai.branch ? branches.find((branch) => branch.name.toLowerCase() === ai.branch!.toLowerCase() || branch.name.toLowerCase().includes(ai.branch!.toLowerCase())) : null;
    const selectedBranchId = (branchMatch || aiBranchMatch)?._id || (branches.length === 1 ? branches[0]!._id : branchId);
    const candidateServices = await ServiceModel.find(branchServiceFilter(salonId, selectedBranchId)).limit(25);
    const matchedService = candidateServices.find((service) => service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId, waPhone: phone },
      {
        $set: {
          branchId: selectedBranchId,
          profileName: message.profileName,
          state: matchedService ? (ai.date ? "select_time" : "select_date") : branchMatch || aiBranchMatch || branches.length === 1 ? "select_category" : "select_branch",
          category: matchedService?.category || null,
          serviceId: matchedService ? String(matchedService._id) : null,
          serviceName: matchedService?.name || null,
          date: ai.date || null,
          startAt: null,
          staffId: null,
          holdAppointmentId: null,
          customerName: message.profileName || "",
          expiresAt: sessionExpiry()
        }
      },
      { upsert: true, new: true }
    );
    if (!session) throw ApiError.badRequest("Unable to start booking session.");
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
    if (matchedService && ai.date && ai.time) return { action: "service_date_time_selected", state: session.state, reply: `I understood ${matchedService.name} on ${displayDate(ai.date)} around ${normalizeTimeInput(ai.time)}. Please send ${normalizeTimeInput(ai.time)} to check availability.` };
    if (matchedService && ai.date) return { action: "service_date_selected", state: session.state, reply: `${matchedService.name} selected for ${displayDate(ai.date)}. Please send your preferred time as HH:mm (24-hour format).` };
    if (matchedService) return { action: "service_selected", state: session.state, reply: `${matchedService.name} is ${money(matchedService.pricePaise)} and takes about ${matchedService.durationMinutes} minutes. Please send appointment date as YYYY-MM-DD.` };
    if (session.state === "select_branch") return { action: "needs_branch", state: session.state, reply: `Which branch would you like to visit?\n${formatOptions(branches.map((b) => b.name))}`, interactive: listInteractive("Which branch would you like to visit?", "Branches", branches.slice(0, 10).map((b) => ({ id: b._id, title: b.name }))) };
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    return { action: "booking_started", state: session.state, reply: `What service would you like?\n${formatOptions(categories)}`, interactive: listInteractive("What service would you like?", "Categories", categories.slice(0, 10).map((c) => ({ id: c, title: c }))) };
  }

  if (session.state === "select_branch") {
    const index = Number(text) - 1;
    const selected = branches[index] || branches.find((branch) => branch._id === text) || branchMatch;
    if (!selected) return { action: "needs_branch", reply: `Please choose a valid branch.\n${formatOptions(branches.map((b) => b.name))}` };
    session.branchId = selected._id;
    session.state = "select_category";
    session.expiresAt = sessionExpiry();
    await session.save();
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    return { action: "branch_selected", reply: `Great. What service would you like?\n${formatOptions(categories)}`, interactive: listInteractive("What service would you like?", "Categories", categories.slice(0, 10).map((c) => ({ id: c, title: c }))) };
  }

  if (session.state === "select_category") {
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    const selected = categories[Number(text) - 1] || categories.find((category) => category === text || category.toLowerCase() === lower || lower.includes(category.toLowerCase()));
    if (!selected) return { action: "needs_category", reply: `Please choose a category.\n${formatOptions(categories)}` };
    session.category = selected;
    session.state = "select_service";
    session.expiresAt = sessionExpiry();
    await session.save();
    const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId, { category: selected })).limit(10);
    return { action: "category_selected", reply: `Choose a service:\n${formatOptions(services.map((s) => `${s.name} - ${money(s.pricePaise)}`))}`, interactive: listInteractive("Choose a service:", "Services", services.slice(0, 10).map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) }))) };
  }

  if (session.state === "select_service") {
    const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId, session.category ? { category: session.category } : {})).limit(10);
    const index = Number(text) - 1;
    const selected = services[index] || services.find((service) => String(service._id) === text || service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    if (!selected) return { action: "needs_service", reply: "Please select a valid service number/name." };
    session.serviceId = String(selected._id);
    session.serviceName = selected.name;
    session.state = "select_date";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "service_selected", service: selected.name, reply: `${selected.name} is ${money(selected.pricePaise)} and takes about ${selected.durationMinutes} minutes. Please send appointment date as YYYY-MM-DD.` };
  }

  if (session.state === "select_date") {
    const dateInput = parseUserDate(ai.date || text);
    if (!dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return { action: "needs_date", reply: "Please send date as YYYY-MM-DD." };
    if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
    session.date = dateInput;
    session.state = "select_time";
    session.expiresAt = sessionExpiry();
    await session.save();
    if (ai.time) return { action: "date_selected", date: dateInput, reply: `Date set to ${displayDate(dateInput)}. Please send ${normalizeTimeInput(ai.time)} to check availability.` };
    return { action: "date_selected", date: dateInput, reply: "Please send your preferred time as HH:mm (24-hour format)." };
  }

  if (session.state === "select_time") {
    const timeInput = normalizeTimeInput(ai.time || text);
    if (!/^\d{2}:\d{2}$/.test(timeInput)) return { action: "needs_time", reply: "Please send time as HH:mm." };
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const [hour, minute] = timeInput.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, session.date || "", hour || 0, minute || 0);
    if (Number.isNaN(startAt.getTime())) return { action: "needs_time", reply: "Invalid time. Please send time as HH:mm." };
    const rescheduleTarget = session.holdAppointmentId ? await AppointmentModel.findOne({ _id: session.holdAppointmentId, salonId, customerId: String(customer._id), status: { $in: ["booked", "confirmed"] } }) : null;
    const availability = await findAvailableStaff({ salonId, branchId: session.branchId, serviceId: session.serviceId || "", startAt, preferredStaffId: session.staffId || undefined, excludeAppointmentId: rescheduleTarget ? String(rescheduleTarget._id) : undefined });
    if (rescheduleTarget) {
      await AppointmentSlotLockModel.deleteMany({ salonId, appointmentId: String(rescheduleTarget._id) });
      await AppointmentSlotLockModel.create(slotInstants(startAt, availability.endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: availability.staffId, appointmentId: String(rescheduleTarget._id), slotAt })));
      rescheduleTarget.branchId = session.branchId;
      rescheduleTarget.staffId = availability.staffId;
      rescheduleTarget.startAt = startAt;
      rescheduleTarget.endAt = availability.endAt;
      rescheduleTarget.status = "confirmed";
      rescheduleTarget.version += 1;
      await rescheduleTarget.save();
      session.state = "completed";
      session.expiresAt = sessionExpiry();
      await session.save();
      return { action: "appointment_rescheduled", appointmentId: String(rescheduleTarget._id), reply: `Your appointment has been rescheduled to ${rescheduleTarget.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.` };
    }
    session.startAt = startAt;
    session.state = "confirm_hold";
    session.expiresAt = sessionExpiry();
    await session.save();
    if (!session.customerName) return { action: "time_selected", reply: "Please send your name." };
    return { action: "time_selected", reply: `${session.serviceName} is available at ${timeInput}. Price: ${money(availability.service.pricePaise)}. Reply HOLD to reserve this slot for 5 minutes.` };
  }

  if (session.state === "awaiting_payment") {
    return { action: "awaiting_payment", reply: "Your slot is held. Please complete the Razorpay payment link. I will confirm automatically after server verification." };
  }

  if (session.state === "confirm_hold") {
    if (lower !== "hold" && lower !== "confirm") return { action: "needs_hold_confirm", reply: "Reply HOLD to reserve this slot for 5 minutes, or CANCEL to stop." };
    if (!session.serviceId || !session.startAt) return { action: "invalid_session", reply: "Booking session expired. Send 'Book appointment' again." };
    await expireCustomerHolds(salonId, session.branchId, String(customer._id));
    const abandoned = await AppointmentModel.countDocuments({ salonId, branchId: session.branchId, customerId: String(customer._id), status: "expired", updatedAt: { $gte: new Date(Date.now() - 30 * 60_000) } });
    if (abandoned >= 3) return { action: "cooldown", reply: "Too many abandoned holds. Please try booking again after 30 minutes." };
    const availability = await findAvailableStaff({ salonId, branchId: session.branchId, serviceId: session.serviceId, startAt: session.startAt, preferredStaffId: session.staffId || undefined });
    const holdExpiresAt = new Date(Date.now() + 5 * 60_000);
    const appointment = await AppointmentModel.create({ salonId, branchId: session.branchId, staffId: availability.staffId, customerId: String(customer._id), customerName: session.customerName || message.profileName || phone, serviceIds: [availability.service.id], serviceNames: [availability.service.name], durationMinutes: availability.service.durationMinutes, value: availability.service.pricePaise, startAt: session.startAt, endAt: availability.endAt, status: "pending", source: "whatsapp", holdExpiresAt });
    await AppointmentSlotLockModel.create(slotInstants(session.startAt, availability.endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: availability.staffId, appointmentId: String(appointment._id), slotAt })));
    const depositPaise = await depositFor(salonId, session.branchId, availability.service.pricePaise);
    session.holdAppointmentId = String(appointment._id);
    session.state = depositPaise > 0 ? "awaiting_payment" : "confirm";
    session.expiresAt = holdExpiresAt;
    await session.save();
    if (depositPaise > 0) {
      const paymentLink = await createRazorpayPaymentLink({ amountPaise: depositPaise, customerName: appointment.customerName || phone, customerPhone: phone, appointmentId: String(appointment._id), salonId });
      appointment.paymentStatus = "pending";
      appointment.depositAmountPaise = depositPaise;
      appointment.paymentProvider = "razorpay";
      appointment.paymentProviderId = paymentLink.id;
      appointment.paymentLink = paymentLink.shortUrl;
      await appointment.save();
      return { action: "payment_required", appointmentId: String(appointment._id), reply: `Slot held for 5 minutes. Pay advance ${money(depositPaise)} here: ${paymentLink.shortUrl}\nAppointment confirms only after Razorpay verifies payment.` };
    }
    return { action: "hold_created", appointmentId: String(appointment._id), reply: "Slot held for 5 minutes. Reply CONFIRM to book it." };
  }

  if (session.state === "confirm_name") {
    session.customerName = text.slice(0, 160);
    session.state = "confirm";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "name_selected", reply: `Confirm booking for ${session.serviceName} on ${displayDate(session.date || "")}? Reply CONFIRM.` };
  }

  if (session.state === "confirm") {
    if (lower !== "confirm") return { action: "needs_confirm", reply: "Reply CONFIRM to create appointment, or CANCEL to stop." };
    const hold = session.holdAppointmentId ? await AppointmentModel.findOne({ _id: session.holdAppointmentId, salonId, status: "pending" }) : null;
    if (!hold || (hold.holdExpiresAt && hold.holdExpiresAt < new Date())) return { action: "hold_expired", reply: "This hold expired. Send 'Book appointment' to choose a new slot." };
    hold.status = "confirmed";
    hold.paymentStatus = "not_required";
    await hold.save();
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booked" } });
    session.state = "completed";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "appointment_created", appointment: { id: String(hold._id) }, reply: `Your appointment is confirmed.\nService: ${hold.serviceNames.join(", ")}\nDate: ${hold.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\nPrice: ${money(hold.value)}\nReply CANCEL or RESCHEDULE for changes.` };
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
        interactive: (result.interactive as Record<string, unknown> | undefined) || null,
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

whatsappRouter.post("/razorpay/webhook", asyncHandler(async (req, res) => {
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  if (!verifyRazorpayWebhook(rawBody, req.header("x-razorpay-signature"))) throw ApiError.unauthorized("Invalid payment webhook signature.");
  const body = req.body as { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: { appointmentId?: string; salonId?: string } } }; payment?: { entity?: { id?: string; status?: string } } } };
  const link = body.payload?.payment_link?.entity;
  const payment = body.payload?.payment?.entity;
  if (body.event !== "payment_link.paid" || !link?.id || !link.notes?.appointmentId || !link.notes?.salonId) {
    ok(res, { ignored: true });
    return;
  }
  const appointment = await AppointmentModel.findOne({ _id: link.notes.appointmentId, salonId: link.notes.salonId, paymentProvider: "razorpay", paymentProviderId: link.id, status: "pending" });
  if (!appointment) {
    ok(res, { ignored: true });
    return;
  }
  if (appointment.holdExpiresAt && appointment.holdExpiresAt < new Date()) {
    appointment.status = "expired";
    appointment.paymentStatus = "failed";
    await appointment.save();
    await AppointmentSlotLockModel.deleteMany({ salonId: appointment.salonId, appointmentId: String(appointment._id) });
    ok(res, { expired: true });
    return;
  }
  appointment.status = "confirmed";
  appointment.paymentStatus = "paid";
  appointment.paymentReference = payment?.id || link.id;
  await appointment.save();
  const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId) : null;
  if (customer?.normalizedPhone) {
    await sendWhatsAppMessage({ salonId: appointment.salonId, appointmentId: String(appointment._id), toPhone: customer.normalizedPhone, type: "confirmation", body: `Your appointment is confirmed.\nService: ${appointment.serviceNames.join(", ")}\nDate: ${appointment.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\nPrice: ${money(appointment.value)}\nAdvance paid: ${money(appointment.depositAmountPaise || 0)}\nRemaining: ${money(Math.max(0, appointment.value - (appointment.depositAmountPaise || 0)))}` });
  }
  ok(res, { confirmed: true, appointmentId: String(appointment._id) });
}));

whatsappRouter.use(embeddedSignupRouter);
