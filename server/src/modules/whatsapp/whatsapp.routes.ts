import { Router, type Request, type Response } from "express";
import { constants, createDecipheriv, createHmac, createPrivateKey, createCipheriv, privateDecrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { loadEnv } from "../../config/env";
import { SalonModel } from "../../models/salon.model";
import { WhatsAppInboundModel } from "../../models/whatsapp-inbound.model";
import { WhatsAppBookingSessionModel } from "../../models/whatsapp-booking-session.model";
import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { CustomerModel } from "../../models/customer.model";
import { UserModel } from "../../models/user.model";
import { ScheduleModel } from "../../models/schedule.model";
import { LeaveModel } from "../../models/leave.model";
import { findAvailableStaff } from "../appointments/availability.service";
import { cancelAppointmentForCustomer, rescheduleAppointmentForCustomer } from "../appointments/appointment.service";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { notifyStaffByStaffId } from "../push/push.service";
import { applyWhatsAppDeliveryStatus, sendWhatsAppMessage } from "./whatsapp.service";
import { zonedTimeToUtc, zonedWeekday } from "../../shared/business-date";
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
  flowResponse?: Record<string, unknown> | null;
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
          messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string }; nfm_reply?: { response_json?: string; body?: string; name?: string } } }>;
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
        let flowResponse: Record<string, unknown> | null = null;
        const responseJson = message.interactive?.nfm_reply?.response_json;
        if (responseJson) {
          try {
            flowResponse = JSON.parse(responseJson) as Record<string, unknown>;
          } catch {
            flowResponse = { raw: responseJson };
          }
        }
        const interactiveText = message.interactive?.button_reply?.title || message.interactive?.button_reply?.id || message.interactive?.list_reply?.title || message.interactive?.list_reply?.id || message.interactive?.nfm_reply?.body || "";
        return {
          phoneNumberId: value?.metadata?.phone_number_id ?? "",
          waPhone: message.from ?? "",
          profileName: value?.contacts?.[0]?.profile?.name ?? "",
          messageId: message.id ?? "",
          text: message.text?.body ?? interactiveText,
          timestampMs: message.timestamp ? Number(message.timestamp) * 1000 : Date.now(),
          flowResponse
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
const WHATSAPP_PAGE_SIZE = 9;
const BOOKING_BLOCKING_STATUSES = ["pending", "booked", "confirmed", "arrived", "in_service"];

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

function pagedOptions<T>(items: T[], page = 0): { pageItems: T[]; page: number; hasNext: boolean; offset: number } {
  const safePage = Math.max(0, page);
  const offset = safePage * WHATSAPP_PAGE_SIZE;
  return { pageItems: items.slice(offset, offset + WHATSAPP_PAGE_SIZE), page: safePage, hasNext: offset + WHATSAPP_PAGE_SIZE < items.length, offset };
}

function isMoreInput(value: string): boolean {
  return ["more", "next", "show more"].includes(value.trim().toLowerCase());
}

function isDoneInput(value: string): boolean {
  return ["done", "no", "no more", "continue", "next", "staff"].includes(value.trim().toLowerCase());
}

function isSearchInput(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(search|find)\s+(.+)$/i);
  return match?.[2]?.trim() || null;
}

function directSearchInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || isMoreInput(trimmed) || isDoneInput(trimmed)) return null;
  if (["yes", "add", "another", "more service", "confirm", "cancel"].includes(trimmed.toLowerCase())) return null;
  return isSearchInput(trimmed) || trimmed;
}

function serviceSearchFilter(salonId: string, branchId: string, query: string): Record<string, unknown> {
  return { ...branchServiceFilter(salonId, branchId), name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } };
}

function pageReply(title: string, items: string[], hasNext: boolean): string {
  return `${title}\n${formatOptions([...items, ...(hasNext ? ["More"] : [])])}`;
}

function bookingFlowInteractive(salonId: string, waPhone: string, branches: Array<{ _id: string; name: string }> = []): Record<string, unknown> | null {
  const env = loadEnv();
  if (!env.WHATSAPP_BOOKING_FLOW_ID) return null;
  const branchOptions = branches.slice(0, 10).map((branch) => ({ id: branch._id, title: branch.name }));
  return {
    type: "flow",
    header: { type: "text", text: "Book your salon appointment" },
    body: { text: "Choose branch, services, staff and slot in one smooth WhatsApp form." },
    footer: { text: "SalonFlow" },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_id: env.WHATSAPP_BOOKING_FLOW_ID,
        flow_token: `${salonId}:${waPhone}:${Date.now()}`,
        flow_cta: "Book appointment",
        flow_action: "navigate",
        flow_action_payload: { screen: "BRANCH", data: { salonId, branches: branchOptions } }
      }
    }
  };
}

async function serviceSearchPage(salonId: string, branchId: string, query: string, page = 0): Promise<{ services: Array<{ _id: unknown; name: string; pricePaise: number }>; hasNext: boolean }> {
  const all = await ServiceModel.find(serviceSearchFilter(salonId, branchId, query)).sort({ name: 1 });
  const paged = pagedOptions(all, page);
  return { services: paged.pageItems, hasNext: paged.hasNext };
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

async function selectedServices(session: { salonId: string; branchId: string; serviceIds?: string[]; serviceId?: string | null }): Promise<Array<{ id: string; name: string; durationMinutes: number; pricePaise: number; eligibleStaffIds: string[] }>> {
  const ids = session.serviceIds?.length ? session.serviceIds : session.serviceId ? [session.serviceId] : [];
  const docs = await ServiceModel.find({ _id: { $in: ids }, salonId: session.salonId, status: "active" }).sort({ name: 1 });
  return docs.map((service) => ({ id: String(service._id), name: service.name, durationMinutes: service.durationMinutes, pricePaise: service.pricePaise, eligibleStaffIds: service.eligibleStaffIds }));
}

function summarizeServices(services: Array<{ name: string; durationMinutes: number; pricePaise: number }>): { names: string[]; duration: number; value: number; label: string } {
  const names = services.map((service) => service.name);
  const duration = services.reduce((sum, service) => sum + service.durationMinutes, 0);
  const value = services.reduce((sum, service) => sum + service.pricePaise, 0);
  return { names, duration, value, label: `${names.join(", ")}\nTotal: ${money(value)}, ${duration} minutes` };
}

async function eligibleStaffForServices(salonId: string, branchId: string, services: Array<{ eligibleStaffIds: string[] }>): Promise<Array<{ staffId: string; name: string }>> {
  const eligibleSets = services.map((service) => service.eligibleStaffIds).filter((ids) => ids.length);
  const commonEligible = eligibleSets.length ? eligibleSets.reduce((common, ids) => common.filter((id) => ids.includes(id))) : [];
  const staffFilter = commonEligible.length ? { staffId: { $in: commonEligible } } : {};
  const users = await UserModel.find({ salonId, branchIds: branchId, status: "active", ...staffFilter }).sort({ name: 1 });
  return users.filter((user) => user.staffId).map((user) => ({ staffId: user.staffId!, name: user.name }));
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return (h === 24 ? 0 : h) * 60 + m;
}

function minutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function isStaffAvailableForBlock(input: { salonId: string; branchId: string; staffId: string; startAt: Date; endAt: Date; date: string; timezone: string }): Promise<boolean> {
  const [schedule, leave, overlap, lockOverlap] = await Promise.all([
    ScheduleModel.findOne({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, scheduleDate: input.date, status: { $ne: "cancelled" } }),
    LeaveModel.findOne({ salonId: input.salonId, staffId: input.staffId, status: { $in: ["pending", "approved"] }, startDate: { $lte: input.date }, endDate: { $gte: input.date } }),
    AppointmentModel.findOne({ salonId: input.salonId, staffId: input.staffId, status: { $in: BOOKING_BLOCKING_STATUSES }, startAt: { $lt: input.endAt }, endAt: { $gt: input.startAt } }),
    AppointmentSlotLockModel.findOne({ salonId: input.salonId, staffId: input.staffId, slotAt: { $gte: input.startAt, $lt: input.endAt } })
  ]);
  if (!schedule || leave || overlap || lockOverlap) return false;
  const startMinutes = localMinutes(input.startAt, input.timezone);
  const endMinutes = localMinutes(input.endAt, input.timezone);
  return startMinutes >= minutes(schedule.startTime) && endMinutes <= minutes(schedule.endTime);
}

async function suggestedSlots(salonId: string, branchId: string, staffId: string, date: string, durationMinutes: number): Promise<Array<{ label: string; startAt: Date }>> {
  const branch = await BranchModel.findOne({ _id: branchId, salonId });
  if (!branch || !durationMinutes) return [];
  const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
  const dayHours = branch.hours.find((hours) => hours.weekday === zonedWeekday(timezone, date));
  if (!dayHours || dayHours.closed) return [];
  const interval = Math.max(5, branch.slotIntervalMinutes || 15);
  const open = minutes(dayHours.open);
  const close = minutes(dayHours.close);
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toLocaleDateString("en-CA");
  const nowMinutes = date === today ? localMinutes(new Date(), timezone) + interval : open;
  const firstSlot = Math.max(open, Math.ceil(nowMinutes / interval) * interval);
  const slots: Array<{ label: string; startAt: Date }> = [];
  for (let slotMinute = firstSlot; slotMinute + durationMinutes <= close; slotMinute += interval) {
    const label = `${String(Math.floor(slotMinute / 60)).padStart(2, "0")}:${String(slotMinute % 60).padStart(2, "0")}`;
    const [hour, minute] = label.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, date, hour || 0, minute || 0);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
    if (await isStaffAvailableForBlock({ salonId, branchId, staffId, startAt, endAt, date, timezone })) slots.push({ label, startAt });
    if (slots.length >= 12) break;
  }
  return slots;
}

function flowString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function flowStringArray(data: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function handleBookingFlowCompletion(salonId: string, message: WaInboundMessage): Promise<Record<string, unknown>> {
  const response = message.flowResponse || {};
  const branchId = flowString(response, ["branchId", "branch_id", "branch"]);
  const staffId = flowString(response, ["staffId", "staff_id", "staff"]);
  const date = flowString(response, ["date", "appointmentDate", "appointment_date"]);
  const time = normalizeTimeInput(flowString(response, ["time", "slot", "appointmentTime", "appointment_time"]));
  const serviceIds = flowStringArray(response, ["serviceIds", "service_ids", "services"]);
  const customerName = flowString(response, ["customerName", "customer_name", "name"]) || message.profileName || normalizePhone(message.waPhone);
  if (!branchId || !staffId || !date || !time || !serviceIds.length) return { action: "flow_incomplete", reply: "I could not read all booking details from the form. Please try again or type 'book appointment'." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isPastBusinessDate(date)) return { action: "flow_invalid_date", reply: "Please choose today or a future date in the booking form." };
  const services = await selectedServices({ salonId, branchId, serviceIds });
  if (!services.length) return { action: "flow_invalid_services", reply: "Selected services were not found. Please open the booking form again." };
  const summary = summarizeServices(services);
  const branch = await BranchModel.findOne({ _id: branchId, salonId, status: "active" });
  if (!branch) return { action: "flow_invalid_branch", reply: "Selected branch was not found. Please open the booking form again." };
  const [hour, minute] = time.split(":").map(Number);
  const startAt = zonedTimeToUtc(branch.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata", date, hour || 0, minute || 0);
  const endAt = new Date(startAt.getTime() + summary.duration * 60_000);
  if (!(await isStaffAvailableForBlock({ salonId, branchId, staffId, startAt, endAt, date, timezone: branch.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata" }))) return { action: "flow_slot_unavailable", reply: "That staff/slot is no longer available. Please open the booking form and choose another slot." };
  const phone = normalizePhone(message.waPhone);
  const customer = await CustomerModel.findOneAndUpdate(
    { salonId, normalizedPhone: phone },
    { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: customerName, whatsappPhoneNumberId: message.phoneNumberId, interactionStatus: "booked" } },
    { upsert: true, new: true }
  );
  const appointment = await AppointmentModel.create({ salonId, branchId, staffId, customerId: String(customer._id), customerName, serviceIds: services.map((service) => service.id), serviceNames: summary.names, durationMinutes: summary.duration, value: summary.value, startAt, endAt, status: "confirmed", source: "whatsapp_flow", paymentStatus: "not_required" });
  await AppointmentSlotLockModel.create(slotInstants(startAt, endAt).map((slotAt) => ({ salonId, branchId, staffId, appointmentId: String(appointment._id), slotAt })));
  return { action: "appointment_created", appointment: { id: String(appointment._id) }, reply: `Your appointment is booked.\nBooking ID: ${String(appointment._id)}\nServices: ${summary.names.join(", ")}\nStaff: ${staffId}\nDate: ${appointment.startAt.toLocaleString("en-IN", { timeZone: branch.timezone || "Asia/Kolkata" })}\nTotal: ${money(summary.value)}\nThis booking is saved for owner and selected staff.` };
}

function flowPrivateKeyPem(): string {
  const env = loadEnv();
  if (env.WHATSAPP_FLOW_PRIVATE_KEY?.trim()) return env.WHATSAPP_FLOW_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (env.WHATSAPP_FLOW_PRIVATE_KEY_PATH?.trim()) return readFileSync(env.WHATSAPP_FLOW_PRIVATE_KEY_PATH, "utf8");
  throw ApiError.unavailableFeature("WhatsApp Flow private key is not configured.");
}

function decryptFlowPayload(body: { encrypted_aes_key?: string; encrypted_flow_data?: string; initial_vector?: string }): { aesKey: Buffer; iv: Buffer; data: Record<string, unknown> } {
  if (!body.encrypted_aes_key || !body.encrypted_flow_data || !body.initial_vector) throw ApiError.badRequest("Invalid WhatsApp Flow encrypted request.");
  const privateKey = createPrivateKey(flowPrivateKeyPem());
  const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(body.encrypted_aes_key, "base64"));
  const encrypted = Buffer.from(body.encrypted_flow_data, "base64");
  const iv = Buffer.from(body.initial_vector, "base64");
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, iv) as ReturnType<typeof createDecipheriv> & { setAuthTag(tag: Buffer): void };
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return { aesKey, iv, data: JSON.parse(decrypted) as Record<string, unknown> };
}

function encryptFlowPayload(data: Record<string, unknown>, aesKey: Buffer, iv: Buffer): string {
  const responseIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const cipher = createCipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, responseIv) as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64");
}

async function whatsappFlowDataResponse(payload: Record<string, unknown>): Promise<{ version: string; screen: string; data: Record<string, unknown> }> {
  const version = String(payload.version || "3.0");
  const action = String(payload.action || "").toLowerCase();
  if (action === "ping") return { version, screen: "", data: { status: "active" } };
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const step = flowString(data, ["step", "trigger"]) || "init";
  const salonId = flowString(data, ["salonId", "salon_id"]) || "salon_realistic_test";
  const branchId = flowString(data, ["branchId", "branch_id", "branch"]);
  const category = flowString(data, ["category"]);
  const serviceIds = flowStringArray(data, ["serviceIds", "service_ids", "services"]).slice(0, 20);
  const staffId = flowString(data, ["staffId", "staff_id", "staff"]);
  const date = flowString(data, ["date", "appointment_date"]);
  const time = normalizeTimeInput(flowString(data, ["time", "slot"]));
  const customerName = flowString(data, ["customerName", "customer_name", "name"]);
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 });
  const resolvedBranchId = branchId || branches[0]?._id || "";
  const branchOptions = branches.map((branch) => ({ id: branch._id, title: branch.name }));
  const dateOptions = Array.from({ length: 14 }, (_, index) => {
    const value = new Date(Date.now() + index * 24 * 60 * 60_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return { id: value, title: displayDate(value) };
  });
  if (step === "category") {
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, resolvedBranchId)).select("category name")).map((service) => service.category || "Services"))].map((value) => ({ id: value, title: value }));
    return { version, screen: "CATEGORY", data: { salonId, branchId: resolvedBranchId, categories } };
  }
  if (step === "services") {
    const filter = branchServiceFilter(salonId, resolvedBranchId, category ? { category } : {});
    const services = await ServiceModel.find(filter).sort({ name: 1 }).limit(100);
    return {
      version,
      screen: "SERVICES",
      data: { salonId, branchId: resolvedBranchId, category, services: services.map((service) => ({ id: String(service._id), title: service.name.slice(0, 30), description: `${money(service.pricePaise)} • ${service.durationMinutes} min` })) }
    };
  }
  if (step === "staff") {
    const docs = await selectedServices({ salonId, branchId: resolvedBranchId, serviceIds });
    const staff = docs.length ? await eligibleStaffForServices(salonId, resolvedBranchId, docs) : [];
    return { version, screen: "STAFF", data: { salonId, branchId: resolvedBranchId, serviceIds, staff: staff.map((item) => ({ id: item.staffId, title: item.name.slice(0, 30) })) } };
  }
  if (step === "date") {
    return { version, screen: "DATE", data: { salonId, branchId: resolvedBranchId, serviceIds, staffId, date: dateOptions } };
  }
  const docs = await selectedServices({ salonId, branchId: resolvedBranchId, serviceIds });
  const summary = summarizeServices(docs);
  const branchTitle = branches.find((branch) => String(branch._id) === resolvedBranchId)?.name || resolvedBranchId;
  const summaryFields = { branch_title: branchTitle, summary_services: summary.names.join(", "), summary_total: money(summary.value), summary_duration: `${summary.duration} minutes` };
  if (step === "slot") {
    const slots = staffId && date && summary.duration ? await suggestedSlots(salonId, resolvedBranchId, staffId, date, summary.duration) : [];
    return { version, screen: "SLOT", data: { salonId, branchId: resolvedBranchId, serviceIds, staffId, date, time: slots.map((slot) => ({ id: slot.label, title: slot.label })), ...summaryFields } };
  }
  if (step === "details") {
    return { version, screen: "DETAILS", data: { salonId, branchId: resolvedBranchId, serviceIds, staffId, date, time, ...summaryFields } };
  }
  if (step === "summary") {
    return { version, screen: "SUMMARY", data: { salonId, branchId: resolvedBranchId, serviceIds, staffId, date, time, customerName, ...summaryFields } };
  }
  return { version, screen: "BRANCH", data: { salonId, branches: branchOptions } };
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

  const sessionValid = !!session && session.expiresAt >= new Date();
  const activeBookingState = !!session && isActiveBookingState(session.state);
  if (sessionValid && (session!.managementAction || isManagementState(session!.state))) {
    return handleManagementState({ salonId, branchId, phone, customer, session: session!, branches, text, lower, message }, null);
  }
  const managementCommand = managementIntent(lower, ai);
  if (managementCommand && !activeBookingState) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, managementCommand);
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
          state: matchedService ? "add_more_services" : branchMatch || aiBranchMatch || branches.length === 1 ? "select_category" : "select_branch",
          category: matchedService?.category || null,
          categoryPage: 0,
          servicePage: 0,
          staffPage: 0,
          serviceId: matchedService ? String(matchedService._id) : null,
          serviceName: matchedService?.name || null,
          serviceIds: matchedService ? [String(matchedService._id)] : [],
          serviceNames: matchedService ? [matchedService.name] : [],
          durationMinutes: matchedService?.durationMinutes || 0,
          value: matchedService?.pricePaise || 0,
          availableSlots: [],
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
    const flowInteractive = bookingFlowInteractive(salonId, phone, branches);
    if (flowInteractive) return { action: "booking_flow", state: session.state, reply: "Tap below to book your appointment in one smooth WhatsApp form.", interactive: flowInteractive };
    if (matchedService) return { action: "service_selected", state: session.state, reply: `${matchedService.name} added. Total: ${money(matchedService.pricePaise)}, ${matchedService.durationMinutes} minutes.\nAdd another service? Reply YES, search <service>, or DONE.` };
    if (session.state === "select_branch") return { action: "needs_branch", state: session.state, reply: `Which branch would you like to visit?\n${formatOptions(branches.map((b) => b.name))}`, interactive: listInteractive("Which branch would you like to visit?", "Branches", branches.slice(0, 10).map((b) => ({ id: b._id, title: b.name }))) };
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    const page = pagedOptions(categories, session.categoryPage || 0);
    return { action: "booking_started", state: session.state, reply: `${pageReply("What service would you like?", page.pageItems, page.hasNext)}\n\nOr type a service name to search, like massage or facial.`, interactive: listInteractive("What service would you like?", "Categories", [...page.pageItems.map((c) => ({ id: c, title: c })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  }

  if (session && isActiveBookingState(session.state) && lower === "cancel") {
    session.state = "cancelled";
    session.managementAction = null;
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "booking_aborted", reply: "Booking cancelled. Send MENU anytime for more options." };
  }

  if (session.state === "select_branch") {
    const index = Number(text) - 1;
    const selected = branches[index] || branches.find((branch) => branch._id === text) || branchMatch;
    if (!selected) return { action: "needs_branch", reply: `Please choose a valid branch.\n${formatOptions(branches.map((b) => b.name))}` };
    session.branchId = selected._id;
    session.state = "select_category";
    session.serviceIds = [];
    session.serviceNames = [];
    session.durationMinutes = 0;
    session.value = 0;
    session.staffId = null;
    session.availableSlots = [];
    session.expiresAt = sessionExpiry();
    await session.save();
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    session.categoryPage = 0;
    await session.save();
    const page = pagedOptions(categories, session.categoryPage || 0);
    return { action: "branch_selected", reply: `${pageReply("Great. What service would you like?", page.pageItems, page.hasNext)}\n\nOr type a service name to search, like massage or facial.`, interactive: listInteractive("What service would you like?", "Categories", [...page.pageItems.map((c) => ({ id: c, title: c })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  }

  if (session.state === "select_category") {
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
    const searchQuery = isSearchInput(text);
    if (searchQuery) {
      const { services, hasNext } = await serviceSearchPage(salonId, session.branchId, searchQuery, 0);
      if (!services.length) return { action: "search_empty", reply: `No services found for "${searchQuery}". Try another search, or choose a category.\n${pageReply("Categories:", pagedOptions(categories, session.categoryPage || 0).pageItems, pagedOptions(categories, session.categoryPage || 0).hasNext)}` };
      session.searchQuery = searchQuery;
      session.category = null;
      session.servicePage = 0;
      session.state = "select_service";
      session.expiresAt = sessionExpiry();
      await session.save();
      return { action: "search_results", reply: pageReply(`Search results for "${searchQuery}":`, services.map((s) => `${s.name} - ${money(s.pricePaise)}`), hasNext), interactive: listInteractive("Choose a service:", "Services", [...services.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    if (isMoreInput(text) || (Number(text) === WHATSAPP_PAGE_SIZE + 1 && (session.categoryPage || 0) * WHATSAPP_PAGE_SIZE + WHATSAPP_PAGE_SIZE < categories.length)) {
      session.categoryPage = (session.categoryPage || 0) + 1;
      session.expiresAt = sessionExpiry();
      await session.save();
      const nextPage = pagedOptions(categories, session.categoryPage);
      return { action: "category_page", reply: pageReply("More categories:", nextPage.pageItems, nextPage.hasNext), interactive: listInteractive("More categories:", "Categories", [...nextPage.pageItems.map((c) => ({ id: c, title: c })), ...(nextPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    const page = pagedOptions(categories, session.categoryPage || 0);
    const selected = page.pageItems[Number(text) - 1] || categories.find((category) => category === text || category.toLowerCase() === lower || lower.includes(category.toLowerCase()));
    if (!selected) {
      const directQuery = directSearchInput(text);
      if (directQuery) {
        const { services, hasNext } = await serviceSearchPage(salonId, session.branchId, directQuery, 0);
        if (services.length) {
          session.searchQuery = directQuery;
          session.category = null;
          session.servicePage = 0;
          session.state = "select_service";
          session.expiresAt = sessionExpiry();
          await session.save();
          return { action: "search_results", reply: pageReply(`Search results for "${directQuery}":`, services.map((s) => `${s.name} - ${money(s.pricePaise)}`), hasNext), interactive: listInteractive("Choose a service:", "Services", [...services.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
      }
      return { action: "needs_category", reply: `${pageReply("Please choose a category.", page.pageItems, page.hasNext)}\n\nOr type any service name to search.` };
    }
    session.category = selected;
    session.state = "select_service";
    session.servicePage = 0;
    session.searchQuery = "";
    session.expiresAt = sessionExpiry();
    await session.save();
    const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId, { category: selected })).sort({ name: 1 });
    const servicePage = pagedOptions(services, session.servicePage || 0);
    return { action: "category_selected", reply: pageReply("Choose a service:", servicePage.pageItems.map((s) => `${s.name} - ${money(s.pricePaise)}`), servicePage.hasNext), interactive: listInteractive("Choose a service:", "Services", [...servicePage.pageItems.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(servicePage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  }

  if (session.state === "select_service") {
    const searchQuery = directSearchInput(text);
    if (searchQuery) {
      session.searchQuery = searchQuery;
      session.servicePage = 0;
      session.expiresAt = sessionExpiry();
      await session.save();
    }
    const filter = session.searchQuery ? serviceSearchFilter(salonId, session.branchId, session.searchQuery) : branchServiceFilter(salonId, session.branchId, session.category ? { category: session.category } : {});
    const services = await ServiceModel.find(filter).sort({ name: 1 });
    if (isMoreInput(text) || (Number(text) === WHATSAPP_PAGE_SIZE + 1 && (session.servicePage || 0) * WHATSAPP_PAGE_SIZE + WHATSAPP_PAGE_SIZE < services.length)) {
      session.servicePage = (session.servicePage || 0) + 1;
      session.expiresAt = sessionExpiry();
      await session.save();
      const nextPage = pagedOptions(services, session.servicePage);
      return { action: "service_page", reply: pageReply("More services:", nextPage.pageItems.map((s) => `${s.name} - ${money(s.pricePaise)}`), nextPage.hasNext), interactive: listInteractive("More services:", "Services", [...nextPage.pageItems.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(nextPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    const page = pagedOptions(services, session.servicePage || 0);
    const index = Number(text) - 1;
    const selected = page.pageItems[index] || services.find((service) => String(service._id) === text || service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    if (!selected) return { action: "needs_service", reply: pageReply("Please select a valid service number/name.", page.pageItems.map((s) => `${s.name} - ${money(s.pricePaise)}`), page.hasNext) };
    const currentIds = session.serviceIds || [];
    if (!currentIds.includes(String(selected._id))) currentIds.push(String(selected._id));
    session.serviceIds = currentIds;
    session.serviceNames = [...new Set([...(session.serviceNames || []), selected.name])];
    session.serviceId = String(selected._id);
    session.serviceName = selected.name;
    const selectedDocs = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
    const summary = summarizeServices(selectedDocs);
    session.durationMinutes = summary.duration;
    session.value = summary.value;
    session.state = "add_more_services";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "service_selected", service: selected.name, reply: `${selected.name} added.\n${summary.label}\nAdd another service? Reply YES, type another service name, or DONE.` };
  }

  if (session.state === "add_more_services") {
    if (!isDoneInput(text) && ["yes", "add", "another", "more service"].includes(lower)) {
      session.state = "select_category";
      session.categoryPage = 0;
      session.servicePage = 0;
      session.searchQuery = "";
      session.expiresAt = sessionExpiry();
      await session.save();
      const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
      const page = pagedOptions(categories, 0);
      return { action: "add_service_category", reply: `${pageReply("Choose another service category:", page.pageItems, page.hasNext)}\n\nOr type any service name to search.`, interactive: listInteractive("Choose another category:", "Categories", [...page.pageItems.map((c) => ({ id: c, title: c })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    const searchQuery = directSearchInput(text);
    if (searchQuery) {
      session.searchQuery = searchQuery;
      session.servicePage = 0;
      session.state = "select_service";
      session.expiresAt = sessionExpiry();
      await session.save();
      const { services, hasNext } = await serviceSearchPage(salonId, session.branchId, searchQuery, 0);
      if (!services.length) return { action: "search_empty", reply: `No services found for "${searchQuery}". Reply YES to browse categories or DONE for staff.` };
      return { action: "search_results", reply: pageReply(`Search results for "${searchQuery}":`, services.map((s) => `${s.name} - ${money(s.pricePaise)}`), hasNext), interactive: listInteractive("Choose a service:", "Services", [...services.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    if (!isDoneInput(text)) return { action: "needs_add_more", reply: "Reply YES to add another service, type a service name to search, or DONE to choose staff." };
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
    const staff = await eligibleStaffForServices(salonId, session.branchId, services);
    if (!staff.length) return { action: "no_staff", reply: "No staff can perform all selected services at this branch. Please start again with 'book appointment'." };
    session.state = "select_staff";
    session.staffPage = 0;
    session.expiresAt = sessionExpiry();
    await session.save();
    const page = pagedOptions(staff, 0);
    return { action: "needs_staff", reply: pageReply("Choose staff:", page.pageItems.map((item) => item.name), page.hasNext), interactive: listInteractive("Choose staff:", "Staff", [...page.pageItems.map((item) => ({ id: item.staffId, title: item.name.slice(0, 24) })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  }

  if (session.state === "select_staff") {
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
    const staff = await eligibleStaffForServices(salonId, session.branchId, services);
    if (isMoreInput(text) || (Number(text) === WHATSAPP_PAGE_SIZE + 1 && (session.staffPage || 0) * WHATSAPP_PAGE_SIZE + WHATSAPP_PAGE_SIZE < staff.length)) {
      session.staffPage = (session.staffPage || 0) + 1;
      session.expiresAt = sessionExpiry();
      await session.save();
      const nextPage = pagedOptions(staff, session.staffPage);
      return { action: "staff_page", reply: pageReply("More staff:", nextPage.pageItems.map((item) => item.name), nextPage.hasNext), interactive: listInteractive("More staff:", "Staff", [...nextPage.pageItems.map((item) => ({ id: item.staffId, title: item.name.slice(0, 24) })), ...(nextPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    const page = pagedOptions(staff, session.staffPage || 0);
    const selected = page.pageItems[Number(text) - 1] || staff.find((item) => item.staffId === text || item.name.toLowerCase() === lower || item.name.toLowerCase().includes(lower));
    if (!selected) return { action: "needs_staff", reply: pageReply("Please choose a valid staff member.", page.pageItems.map((item) => item.name), page.hasNext) };
    session.staffId = selected.staffId;
    session.state = "select_date";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "staff_selected", reply: `${selected.name} selected. Please send appointment date as YYYY-MM-DD.` };
  }

  if (session.state === "select_date") {
    const dateInput = parseUserDate(ai.date || text);
    if (!dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return { action: "needs_date", reply: "Please send date as YYYY-MM-DD." };
    if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
    if (!session.staffId) return { action: "needs_staff", reply: "Please choose staff before selecting a date." };
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, summary.duration);
    if (!slots.length) return { action: "no_slots", reply: "No slots are available for the selected staff on this date. Please send another date." };
    session.date = dateInput;
    session.state = "select_time";
    session.availableSlots = slots;
    session.durationMinutes = summary.duration;
    session.value = summary.value;
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "date_selected", date: dateInput, reply: pageReply(`Available slots on ${displayDate(dateInput)}:`, slots.map((slot) => slot.label), false), interactive: listInteractive("Choose time slot:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
  }

  if (session.state === "select_time") {
    const slotIndex = Number(text) - 1;
    const selectedSlot = (session.availableSlots || [])[slotIndex] || (session.availableSlots || []).find((slot) => slot.label === text);
    const timeInput = selectedSlot ? selectedSlot.label : normalizeTimeInput(ai.time || text);
    if (!/^\d{2}:\d{2}$/.test(timeInput)) return { action: "needs_time", reply: "Please send time as HH:mm." };
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const [hour, minute] = timeInput.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, session.date || "", hour || 0, minute || 0);
    if (Number.isNaN(startAt.getTime())) return { action: "needs_time", reply: "Invalid time. Please send time as HH:mm." };
    const rescheduleTarget = session.holdAppointmentId ? await AppointmentModel.findOne({ _id: session.holdAppointmentId, salonId, customerId: String(customer._id), status: { $in: ["booked", "confirmed"] } }) : null;
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const endAt = new Date(startAt.getTime() + summary.duration * 60_000);
    if (!session.staffId || !(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
    const availability = session.serviceId ? await findAvailableStaff({ salonId, branchId: session.branchId, serviceId: session.serviceId, startAt, preferredStaffId: session.staffId || undefined, excludeAppointmentId: rescheduleTarget ? String(rescheduleTarget._id) : undefined }) : null;
    if (rescheduleTarget) {
      if (!availability) return { action: "invalid_session", reply: "Booking session expired. Send 'Book appointment' again." };
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
    session.durationMinutes = summary.duration;
    session.value = summary.value;
    session.expiresAt = sessionExpiry();
    await session.save();
    if (!session.customerName) return { action: "time_selected", reply: "Please send your name." };
    return { action: "time_selected", reply: `${summary.names.join(", ")} is available at ${timeInput}. Total: ${money(summary.value)}, ${summary.duration} minutes. Reply CONFIRM to book this appointment.` };
  }

  if (session.state === "awaiting_payment") {
    return { action: "awaiting_payment", reply: "Your slot is held. Please complete the Razorpay payment link. I will confirm automatically after server verification." };
  }

  if (session.state === "confirm_hold") {
    if (lower !== "confirm") return { action: "needs_confirm", reply: "Reply CONFIRM to book this appointment, or CANCEL to stop." };
    if ((!session.serviceIds?.length && !session.serviceId) || !session.startAt || !session.staffId) return { action: "invalid_session", reply: "Booking session expired. Send 'Book appointment' again." };
    await expireCustomerHolds(salonId, session.branchId, String(customer._id));
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const endAt = new Date(session.startAt.getTime() + summary.duration * 60_000);
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
    const appointment = await AppointmentModel.create({ salonId, branchId: session.branchId, staffId: session.staffId, customerId: String(customer._id), customerName: session.customerName || message.profileName || phone, serviceIds: services.map((service) => service.id), serviceNames: summary.names, durationMinutes: summary.duration, value: summary.value, startAt: session.startAt, endAt, status: "confirmed", source: "whatsapp", paymentStatus: "not_required" });
    await AppointmentSlotLockModel.create(slotInstants(session.startAt, endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: session.staffId!, appointmentId: String(appointment._id), slotAt })));
    session.holdAppointmentId = String(appointment._id);
    session.state = "completed";
    session.expiresAt = sessionExpiry();
    await session.save();
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booked" } });
    return { action: "appointment_created", appointment: { id: String(appointment._id) }, reply: `Your appointment is booked.\nBooking ID: ${String(appointment._id)}\nServices: ${summary.names.join(", ")}\nStaff: ${session.staffId}\nDate: ${appointment.startAt.toLocaleString("en-IN", { timeZone: timezone })}\nTotal: ${money(summary.value)}\nThis booking is saved for owner and selected staff.` };
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

/* ── Customer booking management (view / cancel / reschedule / modify / rebook) ───────── */

interface ManagementContext {
  salonId: string;
  branchId: string;
  phone: string;
  customer: { _id: unknown; name?: string };
  session: any;
  branches: Array<{ _id: string; name: string }>;
  text: string;
  lower: string;
  message: WaInboundMessage;
}

function isActiveBookingState(state: string): boolean {
  return ["select_branch", "select_category", "select_service", "add_more_services", "select_staff", "select_date", "select_time", "confirm_hold", "awaiting_payment", "confirm_name", "confirm"].includes(state);
}

function isManagementState(state: string): boolean {
  return ["menu", "view_bookings", "manage_booking", "view_history", "select_cancel_booking", "confirm_cancel", "select_reschedule_booking", "reschedule_date", "reschedule_time", "select_modify_booking", "modify_choose_field", "confirm_modify", "select_rebook_booking", "confirm_rebook"].includes(state);
}

function managementIntent(lower: string, ai: { intent?: string }): string | null {
  if (["menu", "main menu", "options", "help"].includes(lower)) return "menu";
  if (["my bookings", "my booking", "view bookings", "upcoming", "upcoming bookings", "my appointments", "see bookings", "bookings"].includes(lower)) return "view_bookings";
  if (["history", "view history", "past bookings", "my history", "previous bookings", "old bookings"].includes(lower) || /(past|history|completed) bookings?/.test(lower)) return "view_history";
  if (ai.intent === "CANCEL_APPOINTMENT" || ["cancel", "cancel booking", "cancel my appointment", "cancel appointment"].includes(lower) || /cancel (my )?(booking|appointment)/.test(lower)) return "cancel";
  if (ai.intent === "RESCHEDULE_APPOINTMENT" || ["reschedule", "reschedule booking"].includes(lower) || /reschedule|move my appointment/.test(lower)) return "reschedule";
  if (["modify booking", "modify my booking", "modify appointment"].includes(lower) || /modify|change (my )?(service|staff|branch|time|date|slot|appointment)/.test(lower)) return "modify";
  if (["rebook", "same again", "book again", "repeat", "repeat booking", "book previous", "rebook service"].includes(lower) || /rebook|same again|book (that|it|again)/.test(lower)) return "rebook";
  return null;
}

const MANAGEMENT_UPCOMING_STATUSES = ["pending", "booked", "confirmed", "arrived"];

function mgmtTimeLine(date: Date | string | number, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(date));
}

function bookingLine(appointment: any, timezone: string): string {
  const status = appointment.status && appointment.status !== "confirmed" ? ` [${appointment.status.replace("_", " ")}]` : "";
  return `${mgmtTimeLine(appointment.startAt, timezone)} — ${(appointment.serviceNames || []).join(", ")}${appointment.value ? ` (${money(appointment.value)})` : ""}${status}`;
}

function bookingRows(appointments: any[], timezone: string): Array<{ id: string; title: string; description?: string }> {
  return appointments.slice(0, 10).map((appointment) => ({
    id: String(appointment._id),
    title: ((appointment.serviceNames || [])[0] || "Appointment").slice(0, 24),
    description: `${mgmtTimeLine(appointment.startAt, timezone)}${appointment.value ? ` • ${money(appointment.value)}` : ""}`
  }));
}

function pickBooking(text: string, bookings: any[]): any {
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= bookings.length) return bookings[number - 1];
  return bookings.find((booking) => String(booking._id) === text);
}

function managementErrorReply(error: unknown): Record<string, unknown> {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "Something went wrong.")
      : "Something went wrong. Please try again.";
  return { action: "management_error", reply: message.slice(0, 500) };
}

async function upcomingBookings(salonId: string, customerId: string, limit: number): Promise<any[]> {
  return AppointmentModel.find({ salonId, customerId, status: { $in: MANAGEMENT_UPCOMING_STATUSES }, startAt: { $gte: new Date() } }).sort({ startAt: 1 }).limit(limit).lean();
}

async function pastBookings(salonId: string, customerId: string, limit: number): Promise<any[]> {
  return AppointmentModel.find({ salonId, customerId, status: { $in: ["completed", "cancelled", "no_show", "expired"] } }).sort({ startAt: -1 }).limit(limit).lean();
}

async function targetAppointmentFor(salonId: string, customerId: string, session: any): Promise<any> {
  return AppointmentModel.findOne({ _id: session.targetAppointmentId, salonId, customerId: String(customerId) }).lean();
}

async function finishManagementSession(session: any): Promise<void> {
  session.managementAction = null;
  session.modifyField = null;
  session.targetAppointmentId = null;
  session.state = "completed";
  session.expiresAt = sessionExpiry();
  await session.save();
}

async function handleManagementState(ctx: ManagementContext, command: string | null): Promise<Record<string, unknown>> {
  const { salonId, phone, customer, branches, lower, text } = ctx;
  let session = ctx.session as any;
  const env = loadEnv();
  const timezone = env.SALON_TIMEZONE || "Asia/Kolkata";
  const customerId = String(customer._id);

  const branchName = (id: string) => branches.find((branch) => branch._id === id)?.name || id;

  const setSession = async (patch: Record<string, unknown>): Promise<any> => {
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId, waPhone: phone },
      { $set: { branchId: ctx.branchId ?? session?.branchId, ...patch, expiresAt: sessionExpiry() } },
      { upsert: true, new: true }
    );
    return session;
  };

  const relistUpcoming = async (prompt: string, state: string, action: string = state): Promise<Record<string, unknown>> => {
    const bookings = await upcomingBookings(salonId, customerId, 10);
    if (!bookings.length) {
      await setSession({ state: "menu", managementAction: null });
      return { action: "no_bookings", reply: "You have no upcoming bookings. Send MENU for options." };
    }
    await setSession({ state, managementAction: action });
    return { action: state, reply: `${prompt}\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}`, interactive: listInteractive("Choose a booking:", "Bookings", bookingRows(bookings, timezone)) };
  };

  const relistHistory = async (): Promise<Record<string, unknown>> => {
    const bookings = await pastBookings(salonId, customerId, 10);
    if (!bookings.length) {
      await setSession({ state: "menu", managementAction: null });
      return { action: "no_history", reply: "You have no past bookings. Send MENU for options." };
    }
    await setSession({ state: "view_history", managementAction: "rebook", targetAppointmentId: null });
    return { action: "view_history", reply: `Your past bookings — reply with a number to book the same service again:\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}`, interactive: listInteractive("Choose a past booking:", "History", bookingRows(bookings, timezone)) };
  };

  const menuReply = async (): Promise<Record<string, unknown>> => {
    await setSession({ state: "menu", managementAction: null, targetAppointmentId: null, modifyField: null });
    return {
      action: "menu",
      reply: "Main menu — what would you like to do?\n1. Book appointment\n2. View my bookings\n3. View history\n4. Reschedule booking\n5. Modify booking\n6. Cancel booking\n7. Rebook a service",
      interactive: listInteractive("Choose an option:", "Menu", [
        { id: "1", title: "Book appointment" },
        { id: "2", title: "View my bookings" },
        { id: "3", title: "View history" },
        { id: "4", title: "Reschedule booking" },
        { id: "5", title: "Modify booking" },
        { id: "6", title: "Cancel booking" },
        { id: "7", title: "Rebook a service" }
      ])
    };
  };

  const startReschedule = async (appointment: any): Promise<Record<string, unknown>> => {
    await setSession({
      managementAction: "reschedule",
      targetAppointmentId: String(appointment._id),
      branchId: appointment.branchId,
      staffId: appointment.staffId,
      serviceIds: appointment.serviceIds || [],
      serviceNames: appointment.serviceNames || [],
      durationMinutes: appointment.durationMinutes || 0,
      value: appointment.value || 0,
      date: null,
      startAt: null,
      availableSlots: [],
      state: "reschedule_date"
    });
    return { action: "reschedule_started", reply: `${(appointment.serviceNames || []).join(", ")} is booked for ${mgmtTimeLine(appointment.startAt, timezone)}.\nWhat date would you like instead? (YYYY-MM-DD)` };
  };

  const startModify = async (appointment: any): Promise<Record<string, unknown>> => {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(appointment.startAt));
    const label = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(appointment.startAt));
    await setSession({
      managementAction: "modify",
      modifyField: null,
      targetAppointmentId: String(appointment._id),
      branchId: appointment.branchId,
      staffId: appointment.staffId,
      serviceIds: appointment.serviceIds || [],
      serviceNames: appointment.serviceNames || [],
      durationMinutes: appointment.durationMinutes || 0,
      value: appointment.value || 0,
      category: null,
      categoryPage: 0,
      servicePage: 0,
      date: localDate,
      startAt: new Date(appointment.startAt),
      availableSlots: [{ label, startAt: new Date(appointment.startAt) }],
      state: "modify_choose_field"
    });
    return { action: "modify_started", reply: `What would you like to change?\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes` };
  };

  const startRebook = async (appointment: any): Promise<Record<string, unknown>> => {
    await setSession({
      managementAction: "rebook",
      modifyField: null,
      targetAppointmentId: String(appointment._id),
      branchId: appointment.branchId,
      staffId: appointment.staffId || null,
      serviceIds: appointment.serviceIds || [],
      serviceNames: appointment.serviceNames || [],
      durationMinutes: appointment.durationMinutes || 0,
      value: appointment.value || 0,
      category: null,
      categoryPage: 0,
      servicePage: 0,
      staffPage: 0,
      date: null,
      startAt: null,
      availableSlots: [],
      state: "select_staff"
    });
    const services = await selectedServices({ salonId, branchId: appointment.branchId, serviceIds: appointment.serviceIds || [] });
    const staff = await eligibleStaffForServices(salonId, appointment.branchId, services);
    if (!staff.length) {
      await setSession({ state: "select_date", managementAction: "rebook" });
      return { action: "rebook_date", reply: `Scheduling ${(appointment.serviceNames || []).join(", ")} again. What date would you like? (YYYY-MM-DD)` };
    }
    const page = pagedOptions(staff, 0);
    return { action: "rebook_staff", reply: `Rebooking ${(appointment.serviceNames || []).join(", ")}. Which staff do you prefer?\n${pageReply("Staff:", page.pageItems.map((item) => item.name), page.hasNext)}`, interactive: listInteractive("Choose staff:", "Staff", [...page.pageItems.map((item) => ({ id: item.staffId, title: item.name.slice(0, 24) })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  };

  const startBookingFromMenu = async (): Promise<Record<string, unknown>> => {
    const selectedBranchId = branches.length === 1 ? branches[0]!._id : ctx.branchId;
    await setSession({
      managementAction: null,
      targetAppointmentId: null,
      modifyField: null,
      branchId: selectedBranchId,
      profileName: ctx.message.profileName,
      state: branches.length === 1 ? "select_category" : "select_branch",
      category: null,
      categoryPage: 0,
      servicePage: 0,
      staffPage: 0,
      serviceId: null,
      serviceName: null,
      serviceIds: [],
      serviceNames: [],
      durationMinutes: 0,
      value: 0,
      availableSlots: [],
      date: null,
      startAt: null,
      staffId: null,
      holdAppointmentId: null,
      customerName: ctx.message.profileName || ""
    });
    if (branches.length > 1) {
      return { action: "booking_started", reply: `Which branch would you like to visit?\n${formatOptions(branches.map((branch) => branch.name))}`, interactive: listInteractive("Which branch?", "Branches", branches.slice(0, 10).map((branch) => ({ id: branch._id, title: branch.name }))) };
    }
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, selectedBranchId)).select("category name")).map((item) => item.category || "Services"))];
    const page = pagedOptions(categories, 0);
    return { action: "booking_started", reply: `${pageReply("What service would you like?", page.pageItems, page.hasNext)}\n\nOr type a service name to search, like massage or facial.`, interactive: listInteractive("Categories:", "Categories", [...page.pageItems.map((category) => ({ id: category, title: category })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  };

  try {
    if (command) {
      switch (command) {
        case "menu":
          return await menuReply();
        case "view_bookings":
          return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        case "view_history":
          return await relistHistory();
        case "cancel":
          return await relistUpcoming("Which appointment should I cancel? Reply with a number.", "select_cancel_booking");
        case "reschedule":
          return await relistUpcoming("Which appointment would you like to reschedule? Reply with a number.", "select_reschedule_booking");
        case "modify":
          return await relistUpcoming("Which booking would you like to modify? Reply with a number.", "select_modify_booking");
        case "rebook":
          return await relistHistory();
        default:
          break;
      }
    }

    if (!session) {
      const reEvaluate = managementIntent(lower, { intent: "" });
      if (reEvaluate) return await handleManagementState({ ...ctx, session: null }, reEvaluate);
      return { action: "ignored", reply: "Send MENU to see your options." };
    }

    if (["menu", "main menu", "options", "help"].includes(lower) && session.state !== "menu") {
      return await menuReply();
    }

    if (lower === "back" || lower === "menu") {
      return await menuReply();
    }

    switch (session.state) {
      case "menu": {
        if (BOOKING_KEYWORDS.includes(lower)) return await startBookingFromMenu();
        const option = Number(text);
        if (option === 1) return await startBookingFromMenu();
        if (option === 2) return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        if (option === 3) return await relistHistory();
        if (option === 4) return await relistUpcoming("Which appointment would you like to reschedule? Reply with a number.", "select_reschedule_booking");
        if (option === 5) return await relistUpcoming("Which booking would you like to modify? Reply with a number.", "select_modify_booking");
        if (option === 6) return await relistUpcoming("Which appointment should I cancel? Reply with a number.", "select_cancel_booking");
        if (option === 7) return await relistHistory();
        return { action: "needs_menu_option", reply: "Please choose a valid menu option (1-7), or send MENU." };
      }

      case "view_bookings": {
        if (lower === "back") return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        await setSession({ targetAppointmentId: String(picked._id), state: "manage_booking", managementAction: "manage" });
        return { action: "manage_booking", reply: `Manage: ${(picked.serviceNames || []).join(", ")} at ${mgmtTimeLine(picked.startAt, timezone)}\n1. Reschedule\n2. Modify booking\n3. Cancel booking\n4. Rebook service\n5. Back to all bookings` };
      }

      case "manage_booking": {
        const target = await targetAppointmentFor(salonId, customerId, session);
        if (!target) {
          await setSession({ state: "menu", managementAction: null });
          return { action: "no_appointment", reply: "That booking is no longer available. Send MENU for options." };
        }
        const action = Number(text);
        if (action === 1) return await startReschedule(target);
        if (action === 2) return await startModify(target);
        if (action === 3) {
          await setSession({ managementAction: "cancel", targetAppointmentId: String(target._id), state: "confirm_cancel" });
          return { action: "needs_cancel_confirm", reply: `Cancel ${(target.serviceNames || []).join(", ")} on ${mgmtTimeLine(target.startAt, timezone)}?\nReply CONFIRM to cancel, or CANCEL to back out.` };
        }
        if (action === 4) return await startRebook(target);
        if (action === 5 || lower === "back") return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        return { action: "needs_manage_action", reply: "Please choose a valid option (1-5)." };
      }

      case "select_cancel_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        await setSession({ managementAction: "cancel", targetAppointmentId: String(picked._id), state: "confirm_cancel" });
        return { action: "needs_cancel_confirm", reply: `Cancel ${(picked.serviceNames || []).join(", ")} on ${mgmtTimeLine(picked.startAt, timezone)}?\nReply CONFIRM to cancel, or CANCEL to back out.` };
      }

      case "confirm_cancel": {
        const target = await targetAppointmentFor(salonId, customerId, session);
        if (!target) {
          await setSession({ state: "menu", managementAction: null });
          return { action: "no_appointment", reply: "That booking no longer exists. Send MENU for options." };
        }
        if (lower.startsWith("confirm") || lower === "yes" || lower === "y") {
          const cancelled = await cancelAppointmentForCustomer(salonId, String(target._id), customerId);
          await finishManagementSession(session);
          return { action: "appointment_cancelled", appointmentId: cancelled.id, reply: `Your ${(target.serviceNames || []).join(", ")} booking on ${mgmtTimeLine(target.startAt, timezone)} has been cancelled. Refunds, if applicable, follow salon policy. Send MENU for more options.` };
        }
        if (lower === "cancel" || lower === "no" || lower === "back") {
          return await relistUpcoming("Which appointment should I cancel? Reply with a number.", "select_cancel_booking");
        }
        return { action: "needs_cancel_confirm", reply: "Reply CONFIRM to cancel this booking, or CANCEL to back out." };
      }

      case "select_reschedule_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        return await startReschedule(picked);
      }

      case "reschedule_date": {
        const dateInput = parseUserDate(text);
        if (!dateInput) return { action: "needs_date", reply: "Please send the new date as YYYY-MM-DD." };
        if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
        if (!session.staffId || !session.durationMinutes) return { action: "invalid_session", reply: "Booking details are missing. Send MENU to start over." };
        const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, session.durationMinutes);
        if (!slots.length) return { action: "no_slots", reply: "No slots are available for the selected staff on this date. Please send another date." };
        await setSession({ state: "reschedule_time", date: dateInput, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })) });
        return { action: "reschedule_slots", reply: `Available slots on ${displayDate(dateInput)}:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose new time:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
      }

      case "reschedule_time": {
        const slotIndex = Number(text) - 1;
        const slots = session.availableSlots || [];
        const selected = slots[slotIndex] || slots.find((slot: any) => slot.label === text || slot.label === normalizeTimeInput(text));
        if (!selected) return { action: "needs_time", reply: `Please choose a valid slot.\n${formatOptions((slots as Array<{ label: string }>).map((slot) => slot.label))}` };
        const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
        const zone = branch?.timezone || timezone;
        const [hour, minute] = String(selected.label).split(":").map(Number);
        const startAt = new Date(selected.startAt as Date) || zonedTimeToUtc(zone, session.date || "", hour || 0, minute || 0);
        const endAt = new Date(startAt.getTime() + session.durationMinutes * 60_000);
        if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone: zone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose reschedule again." };
        const updated = await rescheduleAppointmentForCustomer({ salonId, appointmentId: session.targetAppointmentId, branchId: session.branchId, staffId: session.staffId, serviceIds: session.serviceIds || [], serviceNames: session.serviceNames || [], durationMinutes: session.durationMinutes, value: session.value, startAt, endAt });
        await finishManagementSession(session);
        return { action: "appointment_rescheduled", appointmentId: updated.id, reply: `Your appointment has been rescheduled to ${mgmtTimeLine(startAt, timezone)}. Send MENU for more options.` };
      }

      case "select_modify_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        return await startModify(picked);
      }

      case "modify_choose_field": {
        const field = Number(text);
        if (field === 1 || lower === "service" || lower.includes("change service")) {
          await setSession({ modifyField: "service", category: null, categoryPage: 0, servicePage: 0, serviceId: null, serviceName: null, serviceIds: [], serviceNames: [], state: "select_category" });
          const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((item) => item.category || "Services"))];
          const page = pagedOptions(categories, 0);
          return { action: "modify_service_category", reply: `${pageReply("Choose a new service category:", page.pageItems, page.hasNext)}\n\nOr type any service name to search.`, interactive: listInteractive("Categories:", "Categories", [...page.pageItems.map((category) => ({ id: category, title: category })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
        if (field === 2 || lower === "staff" || lower.includes("change staff")) {
          const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
          const staff = await eligibleStaffForServices(salonId, session.branchId, services);
          if (!staff.length) return { action: "no_staff", reply: "No eligible staff found at this branch. Choose another option." };
          await setSession({ modifyField: "staff", staffPage: 0, state: "select_staff" });
          const page = pagedOptions(staff, 0);
          return { action: "modify_staff", reply: pageReply("Choose staff:", page.pageItems.map((item) => item.name), page.hasNext), interactive: listInteractive("Choose staff:", "Staff", [...page.pageItems.map((item) => ({ id: item.staffId, title: item.name.slice(0, 24) })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
        if (field === 3 || lower === "branch" || lower.includes("change branch")) {
          if (branches.length > 1) {
            await setSession({ modifyField: "branch", state: "select_branch" });
            return { action: "modify_branch", reply: `Which branch would you like to visit instead?\n${formatOptions(branches.map((branch) => branch.name))}` };
          }
          return { action: "modify_branch", reply: "This salon has only one branch. Choose another option." };
        }
        if (field === 4 || lower === "time" || lower === "date" || lower.includes("change time") || lower.includes("change date")) {
          if (!session.staffId || !session.serviceIds?.length) return { action: "needs_more_changes", reply: "Please choose services and staff first, then change the date/time." };
          await setSession({ modifyField: "date_time", state: "select_date" });
          return { action: "modify_date", reply: `Currently ${mgmtTimeLine(session.startAt, timezone)}. What date would you like instead? (YYYY-MM-DD)` };
        }
        if (field === 5 || lower === "done" || lower === "apply" || lower.startsWith("confirm")) {
          return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
        }
        return { action: "needs_modify_field", reply: "Please choose 1 (services), 2 (staff), 3 (branch), 4 (date/time), or 5 (apply changes)." };
      }

      case "select_branch": {
        if (session.managementAction !== "modify") return { action: "ignored", reply: "Send MENU for options." };
        const branchIndex = Number(text) - 1;
        const selectedBranch = branches[branchIndex] || branches.find((branch) => branch._id === text);
        if (!selectedBranch) return { action: "needs_branch", reply: `Please choose a valid branch.\n${formatOptions(branches.map((branch) => branch.name))}` };
        await setSession({ branchId: selectedBranch._id, category: null, categoryPage: 0, servicePage: 0, serviceIds: [], serviceNames: [], durationMinutes: 0, value: 0, state: "select_category" });
        const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, selectedBranch._id)).select("category name")).map((item) => item.category || "Services"))];
        const page = pagedOptions(categories, 0);
        return { action: "modify_branch_category", reply: `${pageReply("Choose a category at the new branch:", page.pageItems, page.hasNext)}\n\nOr type any service name to search.`, interactive: listInteractive("Categories:", "Categories", [...page.pageItems.map((category) => ({ id: category, title: category })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
      }

      case "select_category": {
        if (session.managementAction !== "modify") return { action: "ignored", reply: "Send MENU for options." };
        const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((item) => item.category || "Services"))];
        const page = pagedOptions(categories, session.categoryPage || 0);
        const selectedCategory = page.pageItems[Number(text) - 1] || categories.find((category) => category === text || lower === category.toLowerCase() || lower.includes(category.toLowerCase()));
        if (!selectedCategory) return { action: "needs_category", reply: `${pageReply("Please choose a category.", page.pageItems, page.hasNext)}\n\nOr type any service name to search.` };
        await setSession({ category: selectedCategory, categoryPage: 0, servicePage: 0, serviceIds: [], serviceNames: [], durationMinutes: 0, value: 0, state: "select_service" });
        const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId, { category: selectedCategory })).sort({ name: 1 });
        const servicePage = pagedOptions(services, 0);
        return { action: "modify_service_list", reply: pageReply("Choose a service:", servicePage.pageItems.map((item) => `${item.name} - ${money(item.pricePaise)}`), servicePage.hasNext), interactive: listInteractive("Choose a service:", "Services", [...servicePage.pageItems.map((item) => ({ id: String(item._id), title: item.name.slice(0, 24), description: money(item.pricePaise) })), ...(servicePage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
      }

      case "select_service": {
        if (session.managementAction !== "modify") return { action: "ignored", reply: "Send MENU for options." };
        const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId, session.category ? { category: session.category } : {})).sort({ name: 1 });
        const page = pagedOptions(services, session.servicePage || 0);
        const index = Number(text) - 1;
        const selected = page.pageItems[index] || services.find((item) => String(item._id) === text || item.name.toLowerCase() === lower || lower.includes(item.name.toLowerCase()));
        if (!selected) return { action: "needs_service", reply: pageReply("Please select a valid service:", page.pageItems.map((item) => `${item.name} - ${money(item.pricePaise)}`), page.hasNext) };
        const current = session.serviceIds || [];
        if (!current.includes(String(selected._id))) current.push(String(selected._id));
        await setSession({ serviceIds: current, serviceNames: [...new Set([...(session.serviceNames || []), selected.name])], state: "add_more_services" });
        const docs = await selectedServices({ salonId, branchId: session.branchId, serviceIds: current });
        const summary = summarizeServices(docs);
        await setSession({ durationMinutes: summary.duration, value: summary.value });
        return { action: "modify_service_selected", reply: `${selected.name} added.\n${summary.label}\nAdd another? Reply YES or type another service, or DONE.` };
      }

      case "add_more_services": {
        if (session.managementAction !== "modify") return { action: "ignored", reply: "Send MENU for options." };
        if (!isDoneInput(text) && ["yes", "add", "another", "more service"].includes(lower)) {
          await setSession({ state: "select_category", categoryPage: 0, servicePage: 0 });
          const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((item) => item.category || "Services"))];
          const page = pagedOptions(categories, 0);
          return { action: "modify_add_category", reply: `${pageReply("Choose another category:", page.pageItems, page.hasNext)}\n\nOr type any service name to search.`, interactive: listInteractive("Categories:", "Categories", [...page.pageItems.map((category) => ({ id: category, title: category })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
        if (!isDoneInput(text)) return { action: "needs_add_more", reply: "Reply YES to add another service, type a service name, or DONE to continue." };
        const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
        const sameStaffEligible = session.staffId ? (await eligibleStaffForServices(salonId, session.branchId, services)).some((item) => item.staffId === session.staffId) : false;
        if (sameStaffEligible) {
          return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
        }
        const staff = await eligibleStaffForServices(salonId, session.branchId, services);
        if (!staff.length) return { action: "no_staff", reply: "No staff can perform all selected services at this branch. Choose different services or send MENU." };
        await setSession({ state: "select_staff", staffPage: 0 });
        const page = pagedOptions(staff, 0);
        return { action: "modify_staff", reply: pageReply("Choose staff:", page.pageItems.map((item) => item.name), page.hasNext), interactive: listInteractive("Choose staff:", "Staff", [...page.pageItems.map((item) => ({ id: item.staffId, title: item.name.slice(0, 24) })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
      }

      case "select_staff": {
        if (!["modify", "rebook"].includes(session.managementAction)) return { action: "ignored", reply: "Send MENU for options." };
        const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
        const staff = await eligibleStaffForServices(salonId, session.branchId, services);
        const page = pagedOptions(staff, session.staffPage || 0);
        const selected = page.pageItems[Number(text) - 1] || staff.find((item) => item.staffId === text || item.name.toLowerCase() === lower || item.name.toLowerCase().includes(lower));
        if (!selected) return { action: "needs_staff", reply: pageReply("Please choose a valid staff member.", page.pageItems.map((item) => item.name), page.hasNext) };
        await setSession({ staffId: selected.staffId, state: session.managementAction === "modify" ? "confirm_modify" : "select_date" });
        const selectedUser = await UserModel.findOne({ staffId: selected.staffId, salonId }).lean();
        return session.managementAction === "modify"
          ? await confirmModifyReply(salonId, session, setSession, branchName, timezone)
          : { action: "rebook_date", reply: `${(selectedUser?.name || selected.staffId) || "Staff"} selected. What date would you like? (YYYY-MM-DD)` };
      }

      case "select_date": {
        if (!["modify", "rebook"].includes(session.managementAction)) return { action: "ignored", reply: "Send MENU for options." };
        const dateInput = parseUserDate(text);
        if (!dateInput) return { action: "needs_date", reply: "Please send the date as YYYY-MM-DD." };
        if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
        const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
        const summary = summarizeServices(services);
        const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, summary.duration);
        if (!slots.length) return { action: "no_slots", reply: "No slots are available for the selected staff on this date. Please send another date." };
        await setSession({ state: "select_time", date: dateInput, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })), durationMinutes: summary.duration, value: summary.value });
        return { action: "modify_slots", reply: `Available slots on ${displayDate(dateInput)}:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose time slot:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
      }

      case "select_time": {
        if (!["modify", "rebook"].includes(session.managementAction)) return { action: "ignored", reply: "Send MENU for options." };
        const slotIndex = Number(text) - 1;
        const slots = session.availableSlots || [];
        const selected = slots[slotIndex] || slots.find((slot: any) => slot.label === text || slot.label === normalizeTimeInput(text));
        if (!selected) return { action: "needs_time", reply: `Please choose a valid slot.\n${formatOptions((slots as Array<{ label: string }>).map((slot) => slot.label))}` };
        const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
        const zone = branch?.timezone || timezone;
        const startAt = new Date(selected.startAt as Date);
        const endAt = new Date(startAt.getTime() + session.durationMinutes * 60_000);
        if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone: zone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
        if (session.managementAction === "modify") {
          await setSession({ startAt, state: "confirm_modify" });
          return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
        }
        await setSession({ startAt, state: "confirm_rebook" });
        const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
        const summary = summarizeServices(services);
        return { action: "rebook_confirm", reply: `Create this new appointment?\n${summary.label}\nDate: ${displayDate(session.date || "")} at ${selected.label}\nStaff: ${await staffNameOf(salonId, session.staffId)}\nReply CONFIRM to book.` };
      }

      case "confirm_modify": {
        if (!lower.startsWith("confirm") && lower !== "yes") return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
        return await applyModify(salonId, session, branchName, timezone);
      }

      case "confirm_rebook": {
        if (!lower.startsWith("confirm") && lower !== "yes") return { action: "needs_confirm", reply: "Reply CONFIRM to create this appointment, or send MENU to stop." };
        return await confirmRebookReply(customerId, salonId, session, setSession, timezone);
      }

      case "view_history": {
        const rebookMatch = /^rebook\s+(\d+)$/i.exec(text);
        const historyBookings = await pastBookings(salonId, customerId, 10);
        if (rebookMatch) {
          const index = Number(rebookMatch[1]) - 1;
          if (index >= 0 && index < historyBookings.length) return await startRebook(historyBookings[index]);
        }
        const picked = pickBooking(text, historyBookings);
        if (picked && session.managementAction === "rebook") return await startRebook(picked);
        return { action: "needs_history", reply: `Reply with a valid past booking number to rebook it.\n${formatOptions(historyBookings.map((booking) => bookingLine(booking, timezone)))}` };
      }

      default:
        return { action: "ignored", reply: "Send MENU to see your options." };
    }
  } catch (error) {
    return managementErrorReply(error);
  }
}

async function staffNameOf(salonId: string, staffId: string): Promise<string> {
  const user = await UserModel.findOne({ salonId, staffId }).lean();
  return user?.name || "assigned staff";
}

type SetSessionFn = (patch: Record<string, unknown>) => Promise<unknown>;

async function confirmModifyReply(salonId: string, session: any, setSession: SetSessionFn, branchName: (id: string) => string, timezone: string): Promise<Record<string, unknown>> {
  void setSession;
  if (!session.serviceIds?.length) return { action: "needs_service", reply: "Please choose at least one service before applying changes." };
  if (!session.staffId) return { action: "needs_staff", reply: "Please choose staff before applying changes." };
  if (!session.startAt) return { action: "needs_time", reply: "Please choose a date/time before applying changes." };
  const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
  const summary = summarizeServices(services);
  const endAt = new Date(session.startAt.getTime() + summary.duration * 60_000);
  const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
  const zone = branch?.timezone || timezone;
  if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone: zone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose modify again." };
  const staffName = await staffNameOf(salonId, session.staffId);
  return {
    action: "confirm_modify",
    reply: `Apply these changes?\nBranch: ${branchName(session.branchId)}\nServices: ${summary.names.join(", ")}\nTotal: ${money(summary.value)}\nStaff: ${staffName}\nDate: ${mgmtTimeLine(session.startAt, zone)}\nReply CONFIRM to apply.`
  };
}

async function applyModify(salonId: string, session: any, branchName: (id: string) => string, timezone: string): Promise<Record<string, unknown>> {
  if (!session.serviceIds?.length) return { action: "needs_service", reply: "Please choose at least one service before applying changes." };
  if (!session.staffId) return { action: "needs_staff", reply: "Please choose staff before applying changes." };
  if (!session.startAt) return { action: "needs_time", reply: "Please choose a date/time before applying changes." };
  const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
  const summary = summarizeServices(services);
  const endAt = new Date(session.startAt.getTime() + summary.duration * 60_000);
  const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
  const zone = branch?.timezone || timezone;
  if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone: zone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose modify again." };
  const updated = await rescheduleAppointmentForCustomer({
    salonId,
    appointmentId: session.targetAppointmentId,
    branchId: session.branchId,
    staffId: session.staffId,
    serviceIds: session.serviceIds,
    serviceNames: summary.names,
    durationMinutes: summary.duration,
    value: summary.value,
    startAt: session.startAt,
    endAt
  });
  const staffName = await staffNameOf(salonId, session.staffId);
  await finishManagementSession(session);
  return { action: "appointment_updated", appointmentId: updated.id, reply: `Your appointment has been updated.\nBooking ID: ${updated.id}\nBranch: ${branchName(session.branchId)}\nServices: ${summary.names.join(", ")}\nStaff: ${staffName}\nDate: ${mgmtTimeLine(session.startAt, zone)}\nTotal: ${money(summary.value)}\nSend MENU for more options.` };
}

async function confirmRebookReply(customerId: string, salonId: string, session: any, setSession: SetSessionFn, timezone: string): Promise<Record<string, unknown>> {
  const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
  const summary = summarizeServices(services);
  if (!session.startAt) return { action: "needs_time", reply: "Please choose a time first." };
  const endAt = new Date(session.startAt.getTime() + summary.duration * 60_000);
  const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
  const zone = branch?.timezone || timezone;
  if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone: zone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose rebook again." };
  const phone = session.waPhone;
  const customer = await CustomerModel.findOneAndUpdate({ salonId, normalizedPhone: phone }, { $setOnInsert: { branchId: session.branchId, source: "whatsapp" }, $set: { name: session.customerName || (await waProfileName(salonId, phone)) || phone, interactionStatus: "booked" } }, { upsert: true, new: true });
  const appointment = await AppointmentModel.create({ salonId, branchId: session.branchId, staffId: session.staffId, customerId: String(customer._id), customerName: customer.name, serviceIds: services.map((item) => item.id), serviceNames: summary.names, durationMinutes: summary.duration, value: summary.value, startAt: session.startAt, endAt, status: "confirmed", source: "whatsapp_rebook", paymentStatus: "not_required" });
  await AppointmentSlotLockModel.create(slotInstants(session.startAt, endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: session.staffId, appointmentId: String(appointment._id), slotAt })));
  publishRealtimeEvent(salonId, "appointment.created", { id: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, startAt: appointment.startAt.toISOString(), endAt: appointment.endAt.toISOString(), status: appointment.status, source: "whatsapp_rebook" });
  void notifyStaffByStaffId(salonId, appointment.staffId, {
    title: "New appointment",
    body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    tag: `appointment-${String(appointment._id)}`,
    data: { appointmentId: String(appointment._id), type: "appointment.created" }
  });
  const staffName = await staffNameOf(salonId, session.staffId);
  await setSession({ state: "completed" });
  await finishManagementSession(session);
  return { action: "appointment_created", appointment: { id: String(appointment._id) }, reply: `Your appointment is rebooked.\nBooking ID: ${String(appointment._id)}\nServices: ${summary.names.join(", ")}\nStaff: ${staffName}\nDate: ${mgmtTimeLine(session.startAt, zone)}\nTotal: ${money(summary.value)}\nSend MENU for more options.` };
}

async function waProfileName(salonId: string, phone: string): Promise<string> {
  const customer = await CustomerModel.findOne({ salonId, normalizedPhone: phone }).lean();
  return customer?.name || phone;
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
    const result = message.flowResponse ? await handleBookingFlowCompletion(String(salonId), message) : await handleBookingMessage(String(salonId), branchId, message);
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

whatsappRouter.get("/flows/booking", asyncHandler(async (_req, res) => {
  ok(res, { status: "ok", endpoint: "whatsapp_booking_flow" });
}));

whatsappRouter.post("/flows/booking", asyncHandler(async (_req, res) => {
  const req = _req as Request & { body: { encrypted_aes_key?: string; encrypted_flow_data?: string; initial_vector?: string } };
  const decrypted = decryptFlowPayload(req.body || {});
  const response = await whatsappFlowDataResponse(decrypted.data);
  res.type("text/plain").send(encryptFlowPayload(response, decrypted.aesKey, decrypted.iv));
}));

whatsappRouter.use(embeddedSignupRouter);
