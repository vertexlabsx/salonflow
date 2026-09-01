import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { constants, createDecipheriv, createHmac, createPrivateKey, createCipheriv, privateDecrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { loadEnv } from "../../config/env";
import { SalonModel } from "../../models/salon.model";
import { WhatsAppInboundModel } from "../../models/whatsapp-inbound.model";
import { WhatsAppOutboundModel } from "../../models/whatsapp-outbound.model";
import { WhatsAppBookingSessionModel } from "../../models/whatsapp-booking-session.model";
import { BranchModel } from "../../models/branch.model";
import { ServiceModel } from "../../models/service.model";
import { CustomerModel } from "../../models/customer.model";
import { UserModel } from "../../models/user.model";
import { ScheduleModel } from "../../models/schedule.model";
import { LeaveModel } from "../../models/leave.model";
import { findAvailableStaff } from "../appointments/availability.service";
import { cancelAppointmentForCustomer, rescheduleAppointmentForCustomer, updateAppointmentForCustomer } from "../appointments/appointment.service";
import { logger } from "../../shared/logger";
import { publishRealtimeEvent } from "../realtime/realtime.service";
import { notifyStaffByStaffId } from "../push/push.service";
import { applyWhatsAppDeliveryStatus, sendWhatsAppMessage } from "./whatsapp.service";
import { applyDepositToAppointment, verifyOrRefreshDepositLink } from "./deposit.service";
import { hoursUntil, loadWhatsAppPolicySettings } from "./policy.service";
import { zonedTimeToUtc, zonedWeekday } from "../../shared/business-date";
import { WhatsAppConnectionModel } from "../../models/whatsapp-connection.model";
import { WhatsAppWebhookEventModel } from "../../models/whatsapp-webhook-event.model";
import { embeddedSignupRouter } from "./meta/embedded-signup.routes";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { AppointmentModel } from "../../models/appointment.model";
import { AppointmentSlotLockModel } from "../../models/appointment-slot-lock.model";
import { OwnerSettingsModel } from "../../models/owner-settings.model";
import { WaitlistModel } from "../../models/waitlist.model";
import { NotificationModel } from "../../models/notification.model";
import { createRazorpayPaymentLink, verifyRazorpayWebhook } from "../payments/razorpay.service";
import { extractReceptionistIntent } from "./ai-receptionist.service";
import { conciergeChat } from "./concierge.service";
import { answerFaq, type FaqContext } from "./faq-answer";
import { closestName as fuzzyClosestName, filterBookingsByHints, filterSlotsByPreference, hintLabel, normalizedNameKey, parseNaturalDate, parseTimePreference, pickBestSlot } from "./smart-parse";
import { resolveBranchIntent, resolveServiceIntents, resolveStaffIntent, serviceSynonymQuery } from "./catalog-intent";

export const whatsappRouter = Router();
export const metaWebhookRouter = Router();

const WHATSAPP_READ_PERMISSION = "read:appointments";

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
  /** Stable machine id from an interactive button/list row payload (id takes priority over the human label). */
  interactiveId: string;
  messageType: string;
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
          messages?: Array<{ id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; image?: { id?: string; caption?: string }; document?: { id?: string; caption?: string; filename?: string }; audio?: { id?: string; voice?: boolean }; video?: { id?: string; caption?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string }; nfm_reply?: { response_json?: string; body?: string; name?: string } } }>;
        };
      }>;
    }>;
  };
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const message = value?.messages?.[0];
        if (!message) continue;
        let flowResponse: Record<string, unknown> | null = null;
        const responseJson = message.interactive?.nfm_reply?.response_json;
        if (responseJson) {
          try {
            flowResponse = JSON.parse(responseJson) as Record<string, unknown>;
          } catch {
            flowResponse = { raw: responseJson };
          }
        }
        const interactiveId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || "";
        const interactiveTitle = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.interactive?.nfm_reply?.body || "";
        const interactiveText = interactiveId || interactiveTitle;
        return {
          phoneNumberId: value?.metadata?.phone_number_id ?? "",
          waPhone: message.from ?? "",
          profileName: value?.contacts?.[0]?.profile?.name ?? "",
          messageId: message.id ?? "",
          text: message.text?.body ?? (interactiveText || message.image?.caption || message.document?.caption || message.video?.caption || `[${message.type || "unsupported"}]`),
          timestampMs: message.timestamp ? Number(message.timestamp) * 1000 : Date.now(),
          flowResponse,
          interactiveId: interactiveId || (message.text?.body ? "" : interactiveTitle),
          messageType: message.type || "unknown"
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

const BOOKING_KEYWORDS = ["hi", "hello", "book", "book appointment", "appointment", "i want to book", "need appointment", "book_appointment", "book now", "new appointment"];
const WHATSAPP_PAGE_SIZE = 9;
const BOOKING_BLOCKING_STATUSES = ["pending", "booked", "confirmed", "arrived", "in_service"];

/** Words that signal a salon service request even without "book". Drives the
 *  one-message booking gate and the management->booking escape hatch. */
const SALON_SERVICE_SIGNAL = /book|hair|spa|skin|nail|beard|colour|color|service|facial|cleanup|manicure|pedicure|wax|massage|makeup|thread|bleach|mehendi|henna|walnut|baal|kaat|kat|salon|price|rate/;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function sessionExpiry(): Date {
  return new Date(Date.now() + 30 * 60_000);
}

/** Tracks a confirmed booking on the customer for memory features ("same as
 *  last time", favourite staff/services). Only called after a booking is
 *  actually created/confirmed — never for speculative holds. */
async function recordCustomerBooking(salonId: string, normalizedPhone: string, appointment: { staffId?: string | null; serviceIds: string[]; startAt: Date }): Promise<void> {
  const hour = appointment.startAt.getHours();
  const preferredTime = hour < 12 ? "prefers_morning" : hour < 16 ? "prefers_afternoon" : hour < 19 ? "prefers_evening" : "prefers_late_evening";
  const push: Record<string, unknown> = { favoriteServiceIds: { $each: appointment.serviceIds.map(String).slice(0, 20), $slice: 30 } };
  if (appointment.staffId) push.preferredStaffIds = { $each: [String(appointment.staffId)], $slice: 8 };
  await CustomerModel.updateOne(
    { salonId, normalizedPhone },
    {
      $inc: { visitCount: 1 },
      $set: { lastBookedAt: appointment.startAt, interactionStatus: "booked" },
      $addToSet: { tags: { $each: ["whatsapp_booked", preferredTime] } },
      $push: push
    }
  );
}

async function tagCustomerLead(salonId: string, normalizedPhone: string, tags: string[]): Promise<void> {
  if (!tags.length) return;
  await CustomerModel.updateOne({ salonId, normalizedPhone }, { $addToSet: { tags: { $each: tags.slice(0, 8) } } });
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
  if (!trimmed || /^\d+$/.test(trimmed) || /^[a-f0-9]{24}$/i.test(trimmed) || isMoreInput(trimmed) || isDoneInput(trimmed)) return null;
  if (["yes", "add", "another", "more service", "confirm", "cancel"].includes(trimmed.toLowerCase())) return null;
  return isSearchInput(trimmed) || trimmed;
}

function serviceSearchFilter(salonId: string, branchId: string, query: string): Record<string, unknown> {
  return { ...branchServiceFilter(salonId, branchId), name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } };
}

function pageReply(title: string, items: string[], hasNext: boolean): string {
  return `${title}\n${formatOptions([...items, ...(hasNext ? ["More"] : [])])}`;
}

async function bookingFlowInteractive(salonId: string, waPhone: string, branches: Array<{ _id: string; name: string }> = [], body = "Choose department, branch, date and time in one smooth WhatsApp form."): Promise<Record<string, unknown> | null> {
  const env = loadEnv();
  if (!env.WHATSAPP_BOOKING_FLOW_ID) return null;
  const branchOptions = branches.slice(0, 10).map((branch) => ({ id: branch._id, title: branch.name }));
  const services = await ServiceModel.find({ salonId, status: "active" }).sort({ name: 1 }).limit(24);
  const departmentOptions = services.map((service) => ({ id: String(service._id), title: service.name.slice(0, 30) }));
  const dateOptions = Array.from({ length: 14 }, (_, index) => {
    const value = new Date(Date.now() + index * 24 * 60 * 60_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return { id: value, title: displayDate(value) };
  });
  return {
    type: "flow",
    header: { type: "text", text: "Book your salon appointment" },
    body: { text: body },
    footer: { text: "Solastio" },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_id: env.WHATSAPP_BOOKING_FLOW_ID,
        flow_token: `${salonId}:${waPhone}:${Date.now()}`,
        flow_cta: "Book appointment",
        flow_action: "navigate",
        flow_action_payload: {
          screen: "APPOINTMENT",
          data: {
            salonId,
            department: departmentOptions,
            is_location_enabled: true,
            location: branchOptions,
            is_date_enabled: true,
            date: dateOptions,
            is_time_enabled: false,
            time: []
          }
        }
      }
    }
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function whatsappPage(limit: number, offset: number, total: number): { limit: number; offset: number; total: number; hasMore: boolean } {
  return { limit, offset, total, hasMore: offset + limit < total };
}

whatsappRouter.get("/conversations", requireAuth, requirePermissions(WHATSAPP_READ_PERMISSION), asyncHandler(async (req, res) => {
  const query = z.object({ search: z.string().trim().max(120).default(""), limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const salonId = req.context!.salonId;
  const searchDigits = query.search.replace(/\D/g, "");
  const customerFilter: Record<string, unknown> = { salonId };
  if (query.search) customerFilter.$or = [{ name: safeRegex(query.search) }, ...(searchDigits ? [{ normalizedPhone: new RegExp(searchDigits) }] : [])];
  const customers = await CustomerModel.find(customerFilter).select("name normalizedPhone branchId interactionStatus marketingOptOut lastBookedAt").sort({ updatedAt: -1 }).limit(300).lean();
  const phoneSet = new Set(customers.map((customer) => customer.normalizedPhone).filter(Boolean));
  const messagePhoneFilter = query.search ? (phoneSet.size ? { $in: [...phoneSet] } : searchDigits ? { $regex: searchDigits } : "__no_phone_match__") : undefined;
  const [inbound, outbound] = await Promise.all([
    WhatsAppInboundModel.find({ salonId, ...(messagePhoneFilter ? { waPhone: messagePhoneFilter } : {}) }).sort({ receivedAt: -1 }).limit(500).lean(),
    WhatsAppOutboundModel.find({ salonId, ...(messagePhoneFilter ? { toPhone: messagePhoneFilter } : {}) }).sort({ createdAt: -1 }).limit(500).lean()
  ]);
  for (const row of inbound) phoneSet.add(row.waPhone);
  for (const row of outbound) phoneSet.add(row.toPhone);
  const known = new Map(customers.map((customer) => [customer.normalizedPhone, customer]));
  const missingPhones = [...phoneSet].filter((phone) => phone && !known.has(phone));
  if (missingPhones.length) {
    const moreCustomers = await CustomerModel.find({ salonId, normalizedPhone: { $in: missingPhones } }).select("name normalizedPhone branchId interactionStatus marketingOptOut lastBookedAt").lean();
    for (const customer of moreCustomers) known.set(customer.normalizedPhone, customer);
  }
  const conversations = new Map<string, { phone: string; customerId: string; customerName: string; branchId: string; interactionStatus: string; marketingOptOut: boolean; lastMessageAt: Date | null; lastDirection: "inbound" | "outbound" | null; lastBody: string; lastStatus: string; inboundCount: number; outboundCount: number; appointmentId: string | null }>();
  const ensure = (phone: string) => {
    const customer = known.get(phone) as (typeof customers)[number] | undefined;
    if (!conversations.has(phone)) conversations.set(phone, { phone, customerId: customer?._id ? String(customer._id) : "", customerName: customer?.name || phone, branchId: customer?.branchId || "", interactionStatus: customer?.interactionStatus || "active", marketingOptOut: !!customer?.marketingOptOut, lastMessageAt: null, lastDirection: null, lastBody: "", lastStatus: "", inboundCount: 0, outboundCount: 0, appointmentId: null });
    return conversations.get(phone)!;
  };
  for (const row of inbound) {
    const item = ensure(row.waPhone);
    item.inboundCount += 1;
    if (!item.lastMessageAt || row.receivedAt > item.lastMessageAt) Object.assign(item, { lastMessageAt: row.receivedAt, lastDirection: "inbound", lastBody: row.text, lastStatus: "received", appointmentId: row.appointmentId || item.appointmentId });
  }
  for (const row of outbound) {
    const item = ensure(row.toPhone);
    item.outboundCount += 1;
    const createdAt = row.createdAt || row.lastAttemptAt || null;
    if (createdAt && (!item.lastMessageAt || createdAt > item.lastMessageAt)) Object.assign(item, { lastMessageAt: createdAt, lastDirection: "outbound", lastBody: row.body, lastStatus: row.status, appointmentId: row.appointmentId || item.appointmentId });
  }
  for (const phone of phoneSet) ensure(phone);
  const all = [...conversations.values()].sort((a, b) => (b.lastMessageAt?.getTime() || 0) - (a.lastMessageAt?.getTime() || 0));
  ok(res, { items: all.slice(query.offset, query.offset + query.limit).map((item) => ({ ...item, lastMessageAt: iso(item.lastMessageAt) })), page: whatsappPage(query.limit, query.offset, all.length) });
}));

whatsappRouter.get("/conversations/:phone/messages", requireAuth, requirePermissions(WHATSAPP_READ_PERMISSION), asyncHandler(async (req, res) => {
  const params = z.object({ phone: z.string().trim().min(4).max(40) }).parse(req.params);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(60), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
  const salonId = req.context!.salonId;
  const phone = normalizePhone(params.phone);
  const [customer, inbound, outbound] = await Promise.all([
    CustomerModel.findOne({ salonId, normalizedPhone: phone }).select("name normalizedPhone branchId interactionStatus marketingOptOut lastBookedAt").lean(),
    WhatsAppInboundModel.find({ salonId, waPhone: phone }).sort({ receivedAt: -1 }).limit(400).lean(),
    WhatsAppOutboundModel.find({ salonId, toPhone: phone }).sort({ createdAt: -1 }).limit(400).lean()
  ]);
  const timeline = [
    ...inbound.map((row) => ({ id: String(row._id), direction: "inbound" as const, body: row.text, status: "received", type: "message", appointmentId: row.appointmentId || null, providerMessageId: row.messageId, at: row.receivedAt })),
    ...outbound.map((row) => ({ id: String(row._id), direction: "outbound" as const, body: row.body, status: row.status, type: row.type, appointmentId: row.appointmentId || null, providerMessageId: row.providerMessageId, at: row.createdAt || row.lastAttemptAt || new Date(0), deliveredAt: iso(row.deliveredAt), readAt: iso(row.readAt), error: row.error }))
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  ok(res, { customer: { id: customer?._id ? String(customer._id) : "", name: customer?.name || phone, phone, branchId: customer?.branchId || "", interactionStatus: customer?.interactionStatus || "active", marketingOptOut: !!customer?.marketingOptOut, lastBookedAt: iso(customer?.lastBookedAt) }, items: timeline.slice(query.offset, query.offset + query.limit).map((item) => ({ ...item, at: iso(item.at) })), page: whatsappPage(query.limit, query.offset, timeline.length) });
}));

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

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isPastBusinessDate(value: string, timezone = "Asia/Kolkata"): boolean {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toLocaleDateString("en-CA");
  return value < today;
}

function parseUserDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidDateString(trimmed) ? trimmed : null;
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const normalized = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidDateString(normalized) ? normalized : null;
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

function buttonsInteractive(body: string, buttons: Array<{ id: string; title: string }>): Record<string, unknown> | null {
  if (!buttons.length || buttons.length > 3) return null;
  return { type: "button", body: { text: body }, action: { buttons: buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: button.title } })) } };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

function menuActionFor(value: string): string {
  const t = value.trim().toLowerCase();
  if (["menu", "main menu", "options", "help", "back_to_menu", "back"].includes(t)) return "menu";
  if (["book_appointment", "book", "book now", "new appointment"].includes(t)) return "book_appointment";
  if (["view_bookings", "my bookings", "my booking", "view bookings"].includes(t)) return "view_bookings";
  if (["view_history", "history"].includes(t)) return "view_history";
  if (["reschedule_booking", "reschedule"].includes(t)) return "reschedule_booking";
  if (["modify_booking", "modify"].includes(t)) return "modify_booking";
  if (["cancel_booking", "cancel booking"].includes(t)) return "cancel_booking";
  if (["rebook_service", "rebook"].includes(t)) return "rebook_service";
  const numeric: Record<string, string> = { "1": "book_appointment", "2": "view_bookings", "3": "view_history", "4": "reschedule_booking", "5": "modify_booking", "6": "cancel_booking", "7": "rebook_service" };
  return numeric[t] || "";
}

function modifyFieldOption(value: string): number {
  const t = value.trim().toLowerCase();
  const map: Record<string, number> = { modify_service: 1, modify_staff: 2, modify_branch: 3, modify_datetime: 4, modify_apply: 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
  return map[t] || NaN;
}

const MANAGE_ACTIONS: Record<string, string> = { reschedule: "reschedule", modify: "modify", cancel: "cancel", rebook: "rebook", back: "back", "1": "reschedule", "2": "modify", "3": "cancel", "4": "rebook", "5": "back" };

function manageActionFor(value: string): string {
  const t = value.trim().toLowerCase();
  if (t === "reschedule" || t === "modify" || t === "cancel" || t === "rebook" || t === "back") return t;
  return MANAGE_ACTIONS[t] || "";
}

const CANCEL_TARGET_NOUN = "appointment|appointments|booking|bookings|reservation|reservations|slot|slots|schedule|visit|session|consultation|meeting|appt|id";

const CANCEL_STRICT_VERB = "cancel|cancelled|canceling|cancellation|delete|deleted|deletion|annul|void|terminate|scrub|scrap|scratch|kill|trash|drop|call off|call it off|get rid of|withdraw|discontinue";

const CANCEL_REMOVAL_VERB = "remove|removing|dismiss|forego|eliminate";

const CANCEL_VERB_PHRASE =
  "no cancel|i want to cancel|i wanna cancel|i would like to cancel|i'd like to cancel|i need to cancel|i have to cancel|i must cancel|i wish to cancel|want to cancel|wanna cancel|need to cancel|have to cancel|can i cancel|could i cancel|can you cancel|could you cancel|could u cancel|can u cancel|can you please cancel|could you please cancel|please cancel|cancel please|please cancel it|please delete|delete please|kindly cancel|kindly delete|kindly remove|request cancel|request cancellation|looking to cancel|wish to cancel|cancel it|cancel this|cancel that|delete it|delete this|delete that|remove it|remove this|remove that|cancel my|delete my|remove my|drop my|dismiss my|cancel this booking|cancel the booking|cancel my booking|cancel the appointment|cancel my appointment|delete this booking|delete the booking|delete my booking|remove the booking|remove my booking|remove my appointment|cancel karo|cancel kar do|cancel karva do|booking cancel karo|appointment cancel karo|delete karo|remove karo|cancel all my bookings|cancel all my appointments|cancel today|cancel today's|cancel tomorrow|cancel tomorrow's|cancel the appointment for today|cancel for today|cancel for tomorrow|scratch my appointment|scratch the appointment|scratch that appointment|scratch it|scratch that|scrap my appointment|scrap my booking|call it off|call off|forego my appointment|drop this appointment|drop the appointment|drop my appointment|cancel my visit|cancel my consultation|cancel my haircut|cancel my session|no longer need the appointment|no longer needed|i won't come";

const CANCEL_CIRCUMSTANTIAL =
  "not coming|won't make it|wont make it|can't make it|cant make it|cannot make it|cannot attend|can't attend|cant attend|not able to attend|unable to attend|not attend|something came up|change of plans|changed my plans|not available anymore|i won't be able|i wont be able|no longer available|no longer coming|i'm out of town|im out of town|family emergency|personal emergency|got stuck|stuck in traffic|can't come|cant come|cannot come|i'm not free|im not free";

const CANCEL_NEGATION =
  "not|cannot|can'?t|cant|don'?t|dont|do not|won'?t|wont|wouldn'?t|wouldnt|couldn'?t|couldnt|isn'?t|isnt|never|no need|no longer|no more|changed my mind|keep (my|the)|instead|unless|unless i|i'll stay|ill stay|prefer to keep";

function isAppointmentCancelIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return false;
  if (new RegExp(`\\b(?:${CANCEL_NEGATION})\\b.{0,20}\\b(?:${CANCEL_STRICT_VERB}|${CANCEL_REMOVAL_VERB})\\b`).test(t)) return false;
  const cancelVerb = `(?:${CANCEL_STRICT_VERB}|${CANCEL_REMOVAL_VERB})`;
  if (new RegExp(`\\b${cancelVerb}\\b.{0,35}\\b(?:${CANCEL_TARGET_NOUN})\\b`).test(t)) return true;
  if (new RegExp(`\\b(?:${CANCEL_TARGET_NOUN})\\b.{0,35}\\b${cancelVerb}\\b`).test(t)) return true;
  if (new RegExp(`\\b(?:${CANCEL_VERB_PHRASE})\\b`).test(t)) return true;
  if (new RegExp(`\\b(?:${CANCEL_CIRCUMSTANTIAL})\\b`).test(t)) return true;
  return false;
}

function isAppointmentRescheduleIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return false;
  if (/\b(reschedule|move|shift|postpone|prepone|push|delay|bring forward|move forward|pull forward|make it later|make it earlier)\b/.test(t) && /\b(appointment|booking|slot|time|date|id)?\b/.test(t)) return true;
  if (/\b(change|move|shift)\b/.test(t) && /\b(time|date|slot)\b/.test(t) && /\b(appointment|booking)?\b/.test(t)) return true;
  return false;
}

function isAppointmentModifyIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return false;
  if (/\b(modify|edit|update|change|adjust|switch|alter)\b/.test(t) && /\b(appointment|booking|service|staff|branch|id)\b/.test(t)) return true;
  return false;
}

function isViewBookingsIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  const notHistory = !/\b(history|past|old|previous)\b/.test(t);
  if (/\b(view|show|see|list|my)\b/.test(t) && /\b(bookings?|appointments?)\b/.test(t) && notHistory) return true;
  if (/\b(appointment|booking)\b/.test(t) && /\b(anything|something|when|what|what time|do i have|is there|any|tomorrow|today|kal|this week|this weekend|friday|saturday|sunday)\b/.test(t) && notHistory) return true;
  if (/\b(anything|something|when|do i have|is there)\b/.test(t) && /\b(today|tomorrow|kal|parso|this week|this weekend|next week|friday|saturday|sunday)\b/.test(t) && notHistory) return true;
  if (/\b(what|when|anything|something|do i have|any)\b/.test(t) && (!!parseNaturalDate(t) || /\b(booking|appointment)\b/.test(t)) && notHistory) return true;
  return false;
}

function isHelpIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return ["help", "support", "human", "agent", "talk to human", "call me"].includes(t) || /\b(help|support|human|agent|representative)\b/.test(t);
}

/** Detects salon-availability questions ("are you free sunday morning?", "any slot at 5pm?")
 *  as opposed to the customer's own bookings (which view_bookings handles first). */
function isAvailabilityIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return false;
  if (/\b(open|close|closed|tim(?:e|ing)s?|hours?|opening hours?)\b/.test(t) && !/\b(slot|slots|appointment|booking|available|availability|free)\b/.test(t)) return false;
  if (/\b(my|mine|i have|i've|i've got|my booking|my slot)\b/.test(t) && /\b(booking|appointment|slot)\b/.test(t)) return false;
  const hasAsk = /\b(available|availability|any slot|any slots|free|open|got free|any free|do you have|can you fit|fit me in|is there any|booked up|booked out|opening|open up|openings?|free slot|free slots)\b/.test(t);
  if (!hasAsk) return false;
  const pref = parseTimePreference(t);
  const hasOccasion = !!parseNaturalDate(t, "Asia/Kolkata") || !!pref.time || pref.after != null || pref.before != null || /\b(morning|afternoon|evening|night|today|tomorrow|kal|parso|weekend|weekday|anytime|this week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/.test(t);
  if (!hasOccasion) return false;
  if (/\b(what|when|which)\b/.test(t)) return false;
  return true;
}

/** Detects first-available / "whenever" asks that don't phrase as an availability
 *  question ("earliest slot next week?"), while staying clear of booking/manage
 *  intents ("book a haircut asap" stays a one-message booking). */
function isFlexAvailabilityAsk(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return false;
  if (/\b(book|booking|schedule|my|mine|i have|cancel|reschedule|modify|view)\b/.test(t)) return false;
  if (!/\b(earliest|first available|asap|a\.s\.a\.p|soonest|first slot|earliest slot|anytime|any time|sometime|whenever)\b/.test(t)) return false;
  return !!parseNaturalDate(t, "Asia/Kolkata") || /\b(today|tomorrow|kal|parso|weekend|this week|next week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/.test(t);
}

function isStopFlowIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return ["stop", "exit", "never mind", "nevermind", "leave it", "cancel draft", "abort", "start over", "menu", "main menu", "options"].includes(t);
}

function isAcceptOfferIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return ["yes", "sure", "ok", "okay", "yep", "yeah", "done", "confirm", "confirm this", "book", "book it", "book this", "go ahead", "haan", "han", "ha", "haa", "karo", "kar do", "krdo", "haan haan", "theek hai", "thik hai"].includes(t);
}

function isDeclineOfferIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return ["no", "nope", "nah", "nahi", "na", "mat karo", "forget it", "never mind", "nevermind", "skip", "not now", "not needed", "deny", "cancel offer", "no thanks"].includes(t);
}

function isCorrectionIntent(value: string): boolean {
  const t = value.trim().toLowerCase();
  return /\b(other one|the other|other option|second one|another one|another option|not that one|not this one|wrong one|pick another|pick the other|something else|different one|different staff|different time|aur slot|aur time|do you have anything else|koi aur|dusra|dusra time|any other)\b/.test(t);
}

function extractBookingId(value: string): string | null {
  return value.match(/\b[a-f0-9]{24}\b/i)?.[0] || null;
}

/** Splits a full-sentence move/modify into its "to" clause, e.g.
 *  "move my haircut on Friday to Saturday 5pm with Ananya" -> "Saturday 5pm with Ananya". */
function extractToClause(value: string): string | null {
  const m = value.match(/\bto\s+(.+)$/i);
  if (!m) return null;
  const clause = m[1]!.trim().replace(/[.?!,]+$/, "");
  if (!clause || clause.length > 80) return null;
  return clause;
}

function removeServiceIntent(value: string): { mode: "all" | "first" | "name"; name?: string } | null {
  const t = value.trim().toLowerCase();
  if (!/^remove\b|^delete\b|^drop\b/.test(t)) return null;
  if (/\b(both|all|everything|services?)\b/.test(t)) return { mode: "all" };
  if (/\b(first|1st|one)\b/.test(t)) return { mode: "first" };
  const name = value.replace(/^(remove|delete|drop)\s+/i, "").trim();
  return name ? { mode: "name", name } : null;
}

async function removeDraftServices(session: any, intent: { mode: "all" | "first" | "name"; name?: string }, setSession: (patch: Record<string, unknown>) => Promise<unknown>, salonId: string): Promise<Record<string, unknown>> {
  const ids = [...(session.serviceIds || [])];
  const names = [...(session.serviceNames || [])];
  if (!ids.length) return { action: "no_services_selected", reply: "No services are selected yet. Choose a service or send MENU." };
  let nextIds = ids;
  let nextNames = names;
  if (intent.mode === "all") {
    nextIds = [];
    nextNames = [];
  } else if (intent.mode === "first") {
    nextIds = ids.slice(1);
    nextNames = names.slice(1);
  } else {
    const target = (intent.name || "").toLowerCase();
    const removeIndex = names.findIndex((name) => name.toLowerCase() === target || name.toLowerCase().includes(target) || target.includes(name.toLowerCase()));
    if (removeIndex < 0) return { action: "needs_remove_service", reply: `I could not find that selected service. Selected services:\n${formatOptions(names)}` };
    nextIds = ids.filter((_, index) => index !== removeIndex);
    nextNames = names.filter((_, index) => index !== removeIndex);
  }
  const docs = await selectedServices({ salonId, branchId: session.branchId, serviceIds: nextIds });
  const summary = summarizeServices(docs);
  await setSession({ serviceIds: nextIds, serviceNames: nextNames, serviceId: nextIds[0] || null, serviceName: nextNames[0] || null, durationMinutes: summary.duration, value: summary.value });
  if (!nextIds.length) return { action: "services_removed", reply: "All selected services were removed. Reply YES to browse categories, type a service name, or MENU." };
  return { action: "services_removed", reply: `Updated selected services:\n${summary.label}\nReply YES to add another service, remove another service, or DONE.` };
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

async function isStaffAvailableForBlock(input: { salonId: string; branchId: string; staffId: string; startAt: Date; endAt: Date; date: string; timezone: string; excludeAppointmentId?: string }): Promise<boolean> {
  const [schedule, leave, overlap, lockOverlap] = await Promise.all([
    ScheduleModel.findOne({ salonId: input.salonId, branchId: input.branchId, staffId: input.staffId, scheduleDate: input.date, status: { $ne: "cancelled" } }),
    LeaveModel.findOne({ salonId: input.salonId, staffId: input.staffId, status: { $in: ["pending", "approved"] }, startDate: { $lte: input.date }, endDate: { $gte: input.date } }),
    AppointmentModel.findOne({ salonId: input.salonId, staffId: input.staffId, ...(input.excludeAppointmentId ? { _id: { $ne: input.excludeAppointmentId } } : {}), status: { $in: BOOKING_BLOCKING_STATUSES }, startAt: { $lt: input.endAt }, endAt: { $gt: input.startAt } }),
    AppointmentSlotLockModel.findOne({ salonId: input.salonId, staffId: input.staffId, ...(input.excludeAppointmentId ? { appointmentId: { $ne: input.excludeAppointmentId } } : {}), slotAt: { $gte: input.startAt, $lt: input.endAt } })
  ]);
  if (!schedule || leave || overlap || lockOverlap) return false;
  const startMinutes = localMinutes(input.startAt, input.timezone);
  const endMinutes = localMinutes(input.endAt, input.timezone);
  return startMinutes >= minutes(schedule.startTime) && endMinutes <= minutes(schedule.endTime);
}

async function suggestedSlots(salonId: string, branchId: string, staffId: string, date: string, durationMinutes: number, excludeAppointmentId?: string, maxSlots = 12): Promise<Array<{ label: string; startAt: Date }>> {
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
    if (await isStaffAvailableForBlock({ salonId, branchId, staffId, startAt, endAt, date, timezone, excludeAppointmentId })) slots.push({ label, startAt });
    if (slots.length >= maxSlots) break;
  }
  return slots;
}

/** Finds still-free slots within 45 minutes of a requested slot label (used to offer alternatives when a pick is taken). */
async function freeNearbySlots(salonId: string, branchId: string, staffId: string, date: string, durationMinutes: number, aroundLabel: string, excludeAppointmentId?: string): Promise<Array<{ label: string; startAt: Date }>> {
  const [aroundHour, aroundMinute] = aroundLabel.split(":").map(Number);
  const around = (aroundHour || 0) * 60 + (aroundMinute || 0);
  const slots = await suggestedSlots(salonId, branchId, staffId, date, durationMinutes, excludeAppointmentId, 96);
  return slots
    .filter((slot) => {
      const [h, m] = slot.label.split(":").map(Number);
      const value = (h || 0) * 60 + (m || 0);
      return Math.abs(value - around) <= 45;
    })
    .slice(0, 3);
}

async function smartSlotOptions(input: { salonId: string; branchId: string; staff: Array<{ staffId: string; name: string }>; date: string; durationMinutes: number; preference: ReturnType<typeof parseTimePreference> | null; limit?: number; excludeAppointmentId?: string }): Promise<Array<{ label: string; startAt: Date; staffId: string; staffName: string }>> {
  const options: Array<{ label: string; startAt: Date; staffId: string; staffName: string }> = [];
  for (const item of input.staff.slice(0, 8)) {
    const slots = await suggestedSlots(input.salonId, input.branchId, item.staffId, input.date, input.durationMinutes, input.excludeAppointmentId, 96);
    const filtered = input.preference ? filterSlotsByPreference(slots, input.preference) : slots;
    for (const slot of filtered.length ? filtered : slots) {
      if (options.length >= (input.limit || 3)) break;
      if (!options.some((option) => option.label === slot.label && option.staffId === item.staffId)) options.push({ ...slot, staffId: item.staffId, staffName: item.name });
    }
    if (options.length >= (input.limit || 3)) break;
  }
  return options;
}

function offerFromSmartOptions(input: { branchId: string; date: string; services: Array<{ id: string; name: string; durationMinutes: number; pricePaise: number; eligibleStaffIds: string[] }>; summary: { names: string[]; duration: number; value: number }; options: Array<{ label: string; startAt: Date; staffId: string; staffName: string }>; preference: ReturnType<typeof parseTimePreference> | null }): string {
  const first = input.options[0]!;
  return JSON.stringify({
    branchId: input.branchId,
    date: input.date,
    staffId: first.staffId,
    staffName: first.staffName,
    serviceId: input.services[0]?.id || "",
    serviceName: input.summary.names[0] || "service",
    serviceIds: input.services.map((service) => service.id),
    serviceNames: input.summary.names,
    durationMinutes: input.summary.duration,
    value: input.summary.value,
    label: first.label,
    startAt: first.startAt.toISOString(),
    preference: input.preference,
    expanded: input.options.map((option) => ({ label: option.label, startAt: option.startAt.toISOString(), staffId: option.staffId, staffName: option.staffName }))
  });
}

/** Scans the next 7 days (starting tomorrow) and returns up to 3 dates that have at least one free slot. */
async function nextAvailableDates(salonId: string, branchId: string, staffId: string, durationMinutes: number, fromDate: string, excludeAppointmentId?: string): Promise<string[]> {
  const branch = await BranchModel.findOne({ _id: branchId, salonId });
  const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
  const found: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00`);
  cursor.setDate(cursor.getDate() + 1);
  for (let i = 0; i < 7 && found.length < 3; i += 1) {
    const candidate = cursor.toLocaleDateString("en-CA");
    const slots = await suggestedSlots(salonId, branchId, staffId, candidate, durationMinutes, excludeAppointmentId, 96);
    if (slots.length) found.push(candidate);
    cursor.setDate(cursor.getDate() + 1);
  }
  return found;
}

/** E4: conversational correction — steps a confirmed proposal's session to the next
 *  alternate slot (then staff) stored under `lastAlternates` when the customer
 *  says "no, the other one". No bookings are mutated; the target slot is re-verified. */
async function exchangeToNextAlternate(salonId: string, session: any): Promise<{ exhausted: boolean } | { patch: Record<string, unknown>; reply: string } | null> {
  let data: any = null;
  try {
    data = JSON.parse(session.lastAlternates || "");
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.staffs) || !Array.isArray(data.services)) return { exhausted: true };
  const staffs = data.staffs as Array<{ staffId: string; name: string }>;
  const slotsData = (data.slots || []) as Array<{ label: string; startAt: string }>;
  const pick = data.pick || { staff: 0, slot: 0 };
  const duration = Number(session.durationMinutes || 45);
  const branchId = data.branchId || session.branchId;
  const dateStr = data.date || session.date;
  let nextStaff = pick.staff;
  let nextSlot = pick.slot + 1;
  if (nextSlot >= slotsData.length) {
    nextSlot = 0;
    nextStaff += 1;
    if (nextStaff >= staffs.length) return { exhausted: true };
  }
  const staff = staffs[nextStaff];
  if (!staff) return { exhausted: true };
  let slot = slotsData[nextSlot];
  if (nextStaff !== pick.staff && staff.staffId) {
    const slots = await suggestedSlots(salonId, branchId, staff.staffId, dateStr, duration, undefined, 96);
    const narrowed = filterSlotsByPreference(slots, data.preference || null);
    const next = (narrowed.length ? narrowed : slots)[0];
    if (!next) return { exhausted: true };
    slot = { label: next.label, startAt: next.startAt.toISOString() };
  }
  if (!slot) return { exhausted: true };
  const startAt = new Date(slot.startAt);
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  const free = await isStaffAvailableForBlock({ salonId, branchId, staffId: staff.staffId || session.staffId, startAt, endAt, date: dateStr, timezone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata" });
  if (!free) {
    return await exchangeToNextAlternate(salonId, { ...session, lastAlternates: JSON.stringify({ ...data, pick: { staff: nextStaff, slot: nextSlot } }) });
  }
  const patch = {
    branchId,
    staffId: staff.staffId || session.staffId,
    startAt,
    state: "confirm_hold" as const,
    availableSlots: [],
    holdAppointmentId: null,
    date: dateStr,
    expiresAt: sessionExpiry(),
    lastAlternates: JSON.stringify({ ...data, pick: { staff: nextStaff, slot: nextSlot } })
  };
  const label = slot.label;
  const staffLabel = staff.name || (await staffNameOf(salonId, staff.staffId || session.staffId));
  const serviceLabel = (Array.isArray(session.serviceNames) && session.serviceNames.length ? session.serviceNames : data.services).join(" + ");
  return {
    patch,
    reply: `How about instead:\n${serviceLabel} on ${displayDate(dateStr)} at ${label} with ${staffLabel}. Total: ${money(session.value || 0)}, ${duration} minutes.\nReply CONFIRM to book, or CANCEL to change your mind.`
  };
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

/** Splits a flow slot id of the form "10:30|<staffId>" back into display label + staffId. */
function parseFlowTime(value: string | null | undefined): { label: string; staffId: string } {
  const raw = (value || "").trim();
  const index = raw.indexOf("|");
  if (index < 0) return { label: raw, staffId: "" };
  return { label: raw.slice(0, index).trim(), staffId: raw.slice(index + 1).trim() };
}

/** Builds the human-readable SUMMARY strings shown by the Appointment Booking template. */
async function bookingAppointmentText(salonId: string, input: { departmentId: string; branchId: string; date: string; time: string }): Promise<string> {
  const parsed = parseFlowTime(input.time);
  const [service, branch] = await Promise.all([
    input.departmentId ? ServiceModel.findById(input.departmentId).select("name").lean() : null,
    input.branchId ? BranchModel.findById(input.branchId).select("name").lean() : null
  ]);
  const when = input.date ? `${displayDate(input.date)}${parsed.label ? ` at ${parsed.label}` : ""}` : "";
  return `${service?.name || "Service"} at ${branch?.name || "Branch"}${when ? `\n${when}.` : ""}`;
}

/** Shared booking creator used by both the nfm_reply webhook and the flow's
 *  SUMMARY confirm data_exchange. Accepts the Appointment Booking template
 *  field names (department/location/name) alongside the legacy custom-flow ones. */
async function finalizeFlowBooking(salonId: string, waPhone: string, profileName: string, phoneNumberId: string, response: Record<string, unknown>): Promise<Record<string, unknown>> {
  const timeRaw = flowString(response, ["time", "slot", "appointmentTime", "appointment_time"]);
  const parsedTime = parseFlowTime(timeRaw);
  const branchId = flowString(response, ["branchId", "branch_id", "branch", "location"]);
  const staffId = flowString(response, ["staffId", "staff_id", "staff"]) || parsedTime.staffId;
  const date = flowString(response, ["date", "appointmentDate", "appointment_date"]);
  const time = normalizeTimeInput(parsedTime.label || timeRaw);
  const serviceIds = flowStringArray(response, ["serviceIds", "service_ids", "services", "department"]);
  const customerName = flowString(response, ["customerName", "customer_name", "name"]) || profileName || normalizePhone(waPhone);
  if (!branchId || !staffId || !date || !time || !serviceIds.length) return { action: "flow_incomplete", reply: "I could not read all booking details from the form. Please try again or type 'book appointment'." };
  if (!isValidDateString(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isPastBusinessDate(date)) return { action: "flow_invalid_date", reply: "Please choose today or a future date in the booking form." };
  const services = await selectedServices({ salonId, branchId, serviceIds });
  if (!services.length) return { action: "flow_invalid_services", reply: "Selected services were not found. Please open the booking form again." };
  const summary = summarizeServices(services);
  const branch = await BranchModel.findOne({ _id: branchId, salonId, status: "active" });
  if (!branch) return { action: "flow_invalid_branch", reply: "Selected branch was not found. Please open the booking form again." };
  const [hour, minute] = time.split(":").map(Number);
  const startAt = zonedTimeToUtc(branch.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata", date, hour || 0, minute || 0);
  const endAt = new Date(startAt.getTime() + summary.duration * 60_000);
  const phone = normalizePhone(waPhone);
  const recent = await AppointmentModel.findOne({ salonId, branchId, staffId, startAt, source: "whatsapp_flow", createdAt: { $gte: new Date(Date.now() - 10 * 60_000) } });
  if (recent) return { action: "appointment_created", appointment: { id: String(recent._id) }, reply: "" };
  if (!(await isStaffAvailableForBlock({ salonId, branchId, staffId, startAt, endAt, date, timezone: branch.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata" }))) return { action: "flow_slot_unavailable", reply: "That staff/slot is no longer available. Please open the booking form and choose another slot." };
  const customer = await CustomerModel.findOneAndUpdate(
    { salonId, normalizedPhone: phone },
    { $setOnInsert: { branchId, source: "whatsapp" }, $set: { name: customerName, whatsappPhoneNumberId: phoneNumberId, interactionStatus: "booked" } },
    { upsert: true, new: true }
  );
  const appointment = await AppointmentModel.create({ salonId, branchId, staffId, customerId: String(customer._id), customerName, serviceIds: services.map((service) => service.id), serviceNames: summary.names, durationMinutes: summary.duration, value: summary.value, startAt, endAt, status: "confirmed", source: "whatsapp_flow", paymentStatus: "not_required" });
  try {
    await AppointmentSlotLockModel.create(slotInstants(startAt, endAt).map((slotAt) => ({ salonId, branchId, staffId, appointmentId: String(appointment._id), slotAt })));
  } catch (error) {
    await AppointmentModel.deleteOne({ _id: appointment._id });
    if (isDuplicateKey(error)) return { action: "slot_unavailable", reply: "That staff/slot was just booked by someone else. Please open the booking form and choose another slot." };
    throw error;
  }
  publishRealtimeEvent(salonId, "appointment.created", { id: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, startAt: appointment.startAt.toISOString(), endAt: appointment.endAt.toISOString(), status: appointment.status, source: "whatsapp_flow" });
  await recordCustomerBooking(salonId, phone, { staffId: appointment.staffId, serviceIds: appointment.serviceIds.map(String), startAt: appointment.startAt });
  void notifyStaffByStaffId(salonId, appointment.staffId, {
    title: "New appointment",
    body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: branch.timezone || "Asia/Kolkata" })}`,
    tag: `appointment-${String(appointment._id)}`,
    data: { appointmentId: String(appointment._id), type: "appointment.created" }
  });
  const flowStaffName = await staffNameOf(salonId, staffId);
  const deposit = await applyDepositToAppointment({
    salonId,
    branchId,
    appointmentId: String(appointment._id),
    valuePaise: appointment.value,
    customerName: customerName,
    customerPhone: phone
  });
  await WhatsAppBookingSessionModel.updateOne(
    { salonId, waPhone },
    { $set: { pendingReminder: true, holdAppointmentId: String(appointment._id), state: deposit.applied ? "awaiting_payment" : "menu" }, $setOnInsert: { branchId, profileName: "", expiresAt: sessionExpiry() } },
    { upsert: true }
  );
  if (deposit.applied) {
    return { action: "awaiting_payment", appointment: { id: String(appointment._id) }, reply: `Your slot is held while we process the advance deposit.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName: flowStaffName, branchName: branch.name, startAt, timezone: branch.timezone || "Asia/Kolkata", durationMinutes: summary.duration, value: summary.value })}\nComplete the payment link I just sent. The slot will be released in 30 minutes if not paid.` };
  }
  return { action: "appointment_created", appointment: { id: String(appointment._id) }, reply: withSuccessTip(`Your appointment is booked.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName: flowStaffName, branchName: branch.name, startAt, timezone: branch.timezone || "Asia/Kolkata", durationMinutes: summary.duration, value: summary.value })}\nChoose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders`) };
}

async function handleBookingFlowCompletion(salonId: string, message: WaInboundMessage): Promise<Record<string, unknown>> {
  return finalizeFlowBooking(salonId, message.waPhone, message.profileName || "", message.phoneNumberId, message.flowResponse || {});
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
  const screen = String(payload.screen || "").toUpperCase();
  const [tokenSalonId, tokenWaPhone] = String(payload.flow_token || "").split(":");
  const salonId = flowString(data, ["salonId", "salon_id"]) || tokenSalonId || "salon_realistic_test";
  const waPhone = tokenWaPhone || "";

  if (screen === "APPOINTMENT") {
    return { version, screen: "APPOINTMENT", data: await bookingAppointmentScreenData(salonId, data) };
  }

  const fields = {
    department: flowString(data, ["department"]),
    location: flowString(data, ["location"]),
    date: flowString(data, ["date", "appointmentDate", "appointment_date"]),
    time: flowString(data, ["time", "slot"]),
    name: flowString(data, ["name", "customerName", "customer_name"]),
    email: flowString(data, ["email", "customerEmail"]),
    phone: flowString(data, ["phone", "customerPhone"]),
    more_details: flowString(data, ["more_details", "note", "notes"])
  };

  if (screen === "DETAILS") {
    const appointment = await bookingAppointmentText(salonId, { departmentId: fields.department, branchId: fields.location, date: fields.date, time: fields.time });
    return { version, screen: "SUMMARY", data: { appointment, details: buildFlowDetailsText(fields), salonId, ...fields } };
  }

  if (screen === "SUMMARY") {
    const booking = await finalizeFlowBooking(salonId, waPhone || fields.phone, fields.name, "", fields as Record<string, string>);
    if (booking.reply && (waPhone || fields.phone)) {
      await sendWhatsAppMessage({ salonId, toPhone: normalizePhone(waPhone || fields.phone), type: "utility", body: String(booking.reply), appointmentId: booking.appointment && typeof booking.appointment === "object" && "id" in booking.appointment ? String((booking.appointment as { id: unknown }).id || "") : null, metadata: { dedupeKey: `bot_reply:flow_summary:${String(payload.flow_token || `${waPhone}:${Date.now()}`)}`, source: "bot_reply", action: String(booking.action || "unknown"), hasInteractive: false } });
    }
    const appointment = await bookingAppointmentText(salonId, { departmentId: fields.department, branchId: fields.location, date: fields.date, time: fields.time });
    return { version, screen: "SUMMARY", data: { appointment, details: buildFlowDetailsText(fields), salonId, ...fields } };
  }

  return { version, screen, data: {} };
}

/** Serves the Appointment Booking template's APPOINTMENT screen dependency dropdowns. */
async function bookingAppointmentScreenData(salonId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const departmentId = flowString(data, ["department"]);
  const locationId = flowString(data, ["location"]);
  const date = flowString(data, ["date"]);
  const [branches, services] = await Promise.all([
    BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 }),
    ServiceModel.find({ salonId, status: "active" }).sort({ name: 1 }).limit(24)
  ]);
  const dateOptions = Array.from({ length: 14 }, (_, index) => {
    const value = new Date(Date.now() + index * 24 * 60 * 60_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return { id: value, title: displayDate(value) };
  });
  let timeOptions: Array<{ id: string; title: string }> = [];
  if (departmentId && locationId && date) {
    const docs = await selectedServices({ salonId, branchId: locationId, serviceIds: [departmentId] });
    if (docs.length) {
      const staff = await eligibleStaffForServices(salonId, locationId, docs);
      const slots = staff.length ? await smartSlotOptions({ salonId, branchId: locationId, staff, date, durationMinutes: docs[0]!.durationMinutes, preference: null, limit: 16 }) : [];
      timeOptions = slots.map((slot) => ({ id: `${slot.label}|${slot.staffId}`, title: slot.label }));
    }
  }
  return {
    salonId,
    department: services.map((service) => ({ id: String(service._id), title: service.name.slice(0, 30) })),
    is_location_enabled: true,
    location: branches.map((branch) => ({ id: branch._id, title: branch.name })),
    is_date_enabled: true,
    date: dateOptions,
    is_time_enabled: timeOptions.length > 0,
    time: timeOptions
  };
}

function buildFlowDetailsText(fields: { name: string; email: string; phone: string; more_details: string }): string {
  const lines = [`Name: ${fields.name || "-"}`, `Email: ${fields.email || "-"}`, `Phone: ${fields.phone || "-"}`];
  if (fields.more_details) lines.push("", fields.more_details);
  return lines.join("\n");
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
  let session: any = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: phone });
  const branches = await BranchModel.find({ salonId, status: "active" }).sort({ createdAt: 1 });
  const branchMatch = branches.find((branch) => branch.name.toLowerCase() === lower || lower.includes(branch.name.toLowerCase()));

  /** Starts a fresh booking flow from the entry gate (equivalent to the menu's
   *  "Book appointment" option). Picks the single branch automatically, otherwise
   *  asks which branch first. */
  const startBookingFromMenuIn = async (input: { salonId: string; branchId: string; branches: Array<{ _id: string; name: string }>; message: WaInboundMessage; phone: string }): Promise<Record<string, unknown>> => {
    const selectedBranchId = input.branches.length === 1 ? input.branches[0]!._id : input.branchId;
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId: input.salonId, waPhone: input.phone },
      {
        $set: {
          managementAction: null,
          targetAppointmentId: null,
          modifyField: null,
          branchId: selectedBranchId,
          profileName: input.message.profileName,
          state: input.branches.length === 1 ? "select_category" : "select_branch",
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
          customerName: input.message.profileName || "",
          expiresAt: sessionExpiry()
        }
      },
      { upsert: true, new: true }
    );
    if (input.branches.length > 1) {
      return { action: "booking_started", reply: `Which branch would you like to visit?\n${formatOptions(input.branches.map((branch) => branch.name))}`, interactive: listInteractive("Which branch would you like to visit?", "Branches", input.branches.slice(0, 10).map((branch) => ({ id: branch._id, title: branch.name }))) };
    }
    const categories = [...new Set((await ServiceModel.find(branchServiceFilter(input.salonId, selectedBranchId)).select("category name")).map((item) => item.category || "Services"))];
    const page = pagedOptions(categories, 0);
    return { action: "booking_started", reply: `${pageReply("What service would you like?", page.pageItems, page.hasNext)}\n\nOr type a service name to search, like massage or facial.`, interactive: listInteractive("Categories:", "Categories", [...page.pageItems.map((category) => ({ id: category, title: category })), ...(page.hasNext ? [{ id: "more", title: "More" }] : [])]) };
  };

  const sessionValid = !!session && session.expiresAt >= new Date();
  const activeBookingState = !!session && isActiveBookingState(session.state);
  const idleConversation = !activeBookingState && !(sessionValid && session!.state !== "menu" && isManagementState(session!.state));

  if (idleConversation && /\b(me and my|for me and|my son|my daughter|my wife|my husband|my friend|two people|2 people|family booking|group booking)\b/.test(lower)) {
    await tagCustomerLead(salonId, phone, ["group_booking", "hot_lead"]);
    return { action: "group_booking_detected", reply: "I can help with group/family bookings too. Please book the first person now, then send BOOK AGAIN for the next person so I can keep the timings clean and avoid overlaps. Example: 'book haircut for me tomorrow 5pm'." };
  }

  if (idleConversation && /\b(walk ?in|come now|coming now|right now|abhi|abhi aa|can i come|come today|drop in)\b/.test(lower)) {
    const chosenBranch = (branchMatch || (branches.length === 1 ? branches[0] : null))?._id || branchId;
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata" })).toLocaleDateString("en-CA");
    const services = await ServiceModel.find(branchServiceFilter(salonId, chosenBranch)).select("name pricePaise durationMinutes eligibleStaffIds").sort({ durationMinutes: 1 }).limit(1);
    const staff = services.length ? await eligibleStaffForServices(salonId, chosenBranch, services) : [];
    const options = staff.length && services[0] ? await smartSlotOptions({ salonId, branchId: chosenBranch, staff, date: today, durationMinutes: services[0].durationMinutes || 45, preference: { flexible: true }, limit: 3 }) : [];
    await tagCustomerLead(salonId, phone, ["walk_in_interest", "hot_lead"]);
    if (!options.length) return { action: "walkin_no_slots", reply: "I don't see an immediate walk-in slot right now. Send 'book appointment' and I'll find the next available time." };
    return { action: "walkin_slots", reply: `Walk-in style slots available today:\n${formatOptions(options.map((slot) => `${slot.label} with ${slot.staffName}`))}\nReply like "book ${services[0]!.name} today at ${options[0]!.label}" to lock one.`, interactive: buttonsInteractive("Book now?", [{ id: "book_appointment", title: "Book appointment" }, { id: "menu", title: "Menu" }]) };
  }

  // E5: AI concierge — answers open/greeting/price/availability questions on
  // menu and dead-end paths only. Any booking it proposes is re-verified against
  // the real schedule and commits only via the existing CONFIRM state machine.
  const concierge = async (): Promise<Record<string, unknown> | null> => {
    const env = loadEnv();
    if (!env.WHATSAPP_CONCIERGE_ENABLED || !env.OPENAI_API_KEY) return null;
    if (activeBookingState) return null;
    if (sessionValid && session!.state !== "menu" && isManagementState(session!.state)) return null;
    const turns = Number((session && (session as any).conciergeTurns) || 0);
    if (turns >= env.WHATSAPP_CONCIERGE_MAX_TURNS) return null;
    const branchForConcierge = String((branchMatch || (branches.length === 1 ? branches[0] : null) || (session && session.branchId))?._id || branchId);
    const outcome = await conciergeChat({ text, salonId, branchId: branchForConcierge, customerId: String(customer._id) });
    if (!outcome) return null;

    const upsertSession = (patch: Record<string, unknown>): Promise<any> =>
      WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        {
          $set: { ...patch, conciergeTurns: turns + 1, expiresAt: sessionExpiry(), managementAction: null, targetAppointmentId: null, modifyField: null, categoryPage: 0, servicePage: 0, staffPage: 0 },
          $setOnInsert: { branchId: branchForConcierge, profileName: message.profileName, state: "menu", customerName: message.profileName || "" }
        },
        { upsert: true, new: true }
      );

    if (outcome.proposal) {
      const proposal = outcome.proposal;
      const services = await ServiceModel.find({
        _id: { $in: proposal.serviceIds },
        salonId,
        status: "active",
        $or: [{ branchIds: proposal.branchId }, { branchIds: { $size: 0 } }]
      }).select("name category pricePaise durationMinutes eligibleStaffIds");
      if (!services.length || !services.some((service) => (service.eligibleStaffIds || []).includes(proposal.staffId))) {
        await upsertSession({});
        return { action: "concierge", reply: `${outcome.reply}\n\nThat booking can't be placed right now. Reply MENU or ask me for another time.` };
      }
      const summary = summarizeServices(services);
      const startAt = new Date(proposal.startAt);
      const endAt = new Date(startAt.getTime() + summary.duration * 60_000);
      const branch = await BranchModel.findOne({ _id: proposal.branchId, salonId });
      const timezone = branch?.timezone || env.SALON_TIMEZONE || "Asia/Kolkata";
      const free = await isStaffAvailableForBlock({ salonId, branchId: proposal.branchId, staffId: proposal.staffId, startAt, endAt, date: proposal.date, timezone });
      if (!free) {
        await upsertSession({});
        return { action: "concierge", reply: `${outcome.reply}\n\nThat slot was just booked by someone else. Ask me for another time.` };
      }
      session = await upsertSession({
        branchId: proposal.branchId,
        state: "confirm_hold",
        category: services[0]?.category || null,
        searchQuery: "",
        serviceId: String(services[0]!._id),
        serviceName: services[0]!.name,
        serviceIds: services.map((service) => String(service._id)),
        serviceNames: services.map((service) => service.name),
        durationMinutes: summary.duration,
        value: summary.value,
        availableSlots: [],
        date: proposal.date,
        startAt,
        staffId: proposal.staffId,
        lastAlternates: "",
        earliestOffer: "",
        pendingReminder: false
      });
      return {
        action: "booking_proposal",
        reply: `${outcome.reply}\n\n${proposal.serviceNames.join(" + ")} on ${displayDate(proposal.date)} at ${proposal.label} with ${proposal.staffName}. Total: ${money(summary.value)}, ${summary.duration} minutes.\nReply CONFIRM to book, or CANCEL to change your mind.`,
        interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }])
      };
    }

    await upsertSession({ state: "menu" });
    return { action: "concierge", reply: outcome.reply };
  };

  // E3: instant availability answers — "are you free sunday morning?", "any slot at 5pm tomorrow?"
  // Runs before management-state routing so idle/menu sessions still get availability answers.
  const availabilityReply = async (): Promise<Record<string, unknown>> => {
    const extremeTz = loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const chosenBranch = (branchMatch || (branches.length === 1 ? branches[0] : null))?._id || branchId;
    const dateInput = parseNaturalDate(text, extremeTz);
    if (!dateInput) return { action: "needs_date", reply: "For which day would you like to check availability? e.g. tomorrow or Friday." };
    const serviceDocs = await ServiceModel.find(branchServiceFilter(salonId, chosenBranch)).select("name pricePaise durationMinutes eligibleStaffIds").sort({ durationMinutes: 1 }).limit(2);
    const first = serviceDocs[0] as { name?: string; durationMinutes?: number; eligibleStaffIds?: string[] } | undefined;
    const duration = Number(first?.durationMinutes || 0) || 45;
    const staff = serviceDocs.length ? await eligibleStaffForServices(salonId, chosenBranch, serviceDocs) : [];
    if (!staff.length) return { action: "no_slots", reply: `Let me check… no staff are set up at this branch yet. Try ${displayDate(dateInput)} with a service instead, or send MENU.` };
    const preference = parseTimePreference(text);
    const seen: Array<{ label: string; staffName: string }> = [];
    for (const item of staff.slice(0, 4)) {
      const slots = await suggestedSlots(salonId, chosenBranch, item.staffId, dateInput, duration, undefined, 96);
      for (const slot of filterSlotsByPreference(slots, preference)) {
        if (seen.length >= 4) break;
        if (!seen.some((entry) => entry.label === slot.label && entry.staffName === item.name)) seen.push({ label: slot.label, staffName: item.name });
      }
      if (seen.length >= 4) break;
    }
    if (!seen.length) {
      const next = await nextAvailableDates(salonId, chosenBranch, staff[0]!.staffId, duration, dateInput);
      const hint = next.length ? ` Next free: ${next.slice(0, 3).map(displayDate).join(", ")}.` : "";
      return { action: "no_slots", reply: `No free slots on ${displayDate(dateInput)}.${hint}\nSend another day/time, or MENU.` };
    }
    if (preference.flexible === true) {
      const earliest = seen[0]!;
      const offerStaff = staff.slice(0, 4).find((s) => s.name === earliest.staffName) || staff[0];
      const servicePick = serviceDocs[0];
      const offer = JSON.stringify({
        branchId: chosenBranch,
        date: dateInput,
        staffId: offerStaff.staffId,
        staffName: earliest.staffName,
        serviceId: String((servicePick && (servicePick as { _id?: unknown })._id) || ""),
        serviceName: first?.name || "service",
        durationMinutes: duration,
        label: earliest.label,
        startAt: (() => {
          const [oh, om] = earliest.label.split(":").map(Number);
          return zonedTimeToUtc(extremeTz, dateInput, oh || 0, om || 0).toISOString();
        })(),
        expanded: seen.slice(0, 4).map((slot) => ({ label: slot.label, staffName: slot.staffName }))
      });
      await WhatsAppBookingSessionModel.updateOne(
        { salonId, waPhone: phone },
        { $set: { earliestOffer: offer }, $setOnInsert: { branchId: chosenBranch, state: "menu", expiresAt: sessionExpiry() } },
        { upsert: true }
      );
      return { action: "availability_earliest", reply: `Earliest free on ${displayDate(dateInput)}: ${earliest.label} (with ${earliest.staffName}) for ${first?.name || "a service"}.\nReply YES to book it, or tell me another day/time.` };
    }
    return {
      action: "availability",
      reply: `Here's what I have free on ${displayDate(dateInput)}:\n${formatOptions(seen.map((slot) => `${slot.label} (with ${slot.staffName})`))}\nReply like "book a ${first?.name || "service"} <date> at <time>" to lock one, or tell me another day/time.`
    };
  };
  if (isAvailabilityIntent(lower) || isFlexAvailabilityAsk(lower)) {
    if (!activeBookingState && !(sessionValid && session!.state !== "menu" && isManagementState(session!.state))) {
      return await availabilityReply();
    }
  }

  if (idleConversation && sessionValid && session!.earliestOffer) {
    const numericOfferChoice = /^\d+$/.test(lower) ? Number(lower) : 0;
    if (isAcceptOfferIntent(lower) || numericOfferChoice > 0) {
      let offer: any = null;
      try {
        offer = JSON.parse(session!.earliestOffer);
      } catch {
        offer = null;
      }
      if (numericOfferChoice > 0 && Array.isArray(offer?.expanded) && offer.expanded[numericOfferChoice - 1]) {
        const chosen = offer.expanded[numericOfferChoice - 1];
        offer = { ...offer, staffId: chosen.staffId || offer.staffId, staffName: chosen.staffName || offer.staffName, label: chosen.label || offer.label, startAt: chosen.startAt || offer.startAt };
      }
      if (!offer || !offer.staffId || !offer.date || !offer.startAt) {
        await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { earliestOffer: "" } });
        return { action: "offer_invalid", reply: "That offer expired. Ask me for another day/time, or send MENU." };
      }
      const offerServiceIds = Array.isArray(offer.serviceIds) && offer.serviceIds.length ? offer.serviceIds.map(String) : offer.serviceId ? [String(offer.serviceId)] : [];
      const offerServices = offerServiceIds.length ? await selectedServices({ salonId, branchId: offer.branchId || branchId, serviceIds: offerServiceIds }) : [];
      const offerSummary = summarizeServices(offerServices);
      const oService = offerServices[0] || null;
      const startAt = new Date(offer.startAt);
      const endAt = new Date(startAt.getTime() + (offer.durationMinutes || 45) * 60_000);
      const free = await isStaffAvailableForBlock({ salonId, branchId: offer.branchId || branchId, staffId: offer.staffId, startAt, endAt, date: offer.date, timezone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata" });
      if (!free) {
        await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { earliestOffer: "" } });
        return { action: "offer_unavailable", reply: "That slot just got taken. Ask me for the next earliest, or send MENU." };
      }
      const offerDuration = offerSummary.duration || oService?.durationMinutes || offer.durationMinutes || 45;
      const offerValue = offerSummary.value || oService?.pricePaise || offer.value || 0;
      const offerNames = offerSummary.names.length ? offerSummary.names : Array.isArray(offer.serviceNames) ? offer.serviceNames : [oService?.name || offer.serviceName || "this service"];
      const offerName = offerNames.join(", ");
      session = await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        {
          $set: {
            branchId: offer.branchId || branchId,
            profileName: message.profileName,
            state: "confirm_hold",
            managementAction: null,
            targetAppointmentId: null,
            modifyField: null,
            category: null,
            categoryPage: 0,
            servicePage: 0,
            staffPage: 0,
            serviceId: offerServiceIds[0] || "",
            serviceName: offerNames[0] || offerName,
            serviceIds: offerServiceIds,
            serviceNames: offerNames,
            durationMinutes: offerDuration,
            value: offerValue,
            availableSlots: [],
            date: offer.date,
            startAt,
            staffId: offer.staffId,
            holdAppointmentId: null,
            customerName: message.profileName || "",
            earliestOffer: "",
            lastAlternates: JSON.stringify({
              text: text.slice(0, 200),
              branchId: offer.branchId || branchId,
              date: offer.date,
              preference: null,
              services: offerNames,
              staffs: [{ staffId: offer.staffId, name: offer.staffName || "" }],
              slots: (offer.expanded || [{ label: offer.label, startAt: offer.startAt, staffName: offer.staffName }]).map((slot: any) => ({ label: slot.label, startAt: slot.startAt || offer.startAt })),
              pick: { staff: 0, slot: 0 }
            }),
            expiresAt: sessionExpiry()
          }
        },
        { upsert: true, new: true }
      );
      await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
      return {
        action: "booking_proposal",
        reply: `${offerName} on ${displayDate(offer.date)} at ${offer.label} with ${offer.staffName || "staff"}. Total: ${money(offerValue)}, ${offerDuration} minutes.\nReply CONFIRM to book, or CANCEL to change your mind.`,
        interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }])
      };
    }
    if (isDeclineOfferIntent(lower)) {
      await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { earliestOffer: "" } });
      return { action: "offer_declined", reply: "Okay, no booking. Ask me for another day/time whenever you want, or send MENU." };
    }
  }

  if (idleConversation && sessionValid && session!.pendingReminder) {
    const reminderPreference = lower === "1" || /both|all|day.*2|2.*day/.test(lower) ? "both" : lower === "2" || /only.*2|2 hour|two hour|short/.test(lower) ? "short" : lower === "3" || /only.*day|day before|tomorrow/.test(lower) ? "day_before" : lower === "4" || isDeclineOfferIntent(lower) ? "none" : null;
    if (reminderPreference && reminderPreference !== "none") {
      if (session!.holdAppointmentId) {
        await AppointmentModel.updateOne({ _id: session!.holdAppointmentId, salonId }, { $set: { reminderOptIn: true, reminderPreference } }, { runValidators: true });
      }
      await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { pendingReminder: false, reminderPreference } });
      const label = reminderPreference === "both" ? "the day before and again 2 hours before" : reminderPreference === "short" ? "2 hours before" : "the day before";
      return { action: "reminder_optin", reply: `You're all set — I'll remind you ${label}.` };
    }
    if (reminderPreference === "none") {
      if (session!.holdAppointmentId) await AppointmentModel.updateOne({ _id: session!.holdAppointmentId, salonId }, { $set: { reminderOptIn: false, reminderPreference: "none" } }, { runValidators: true });
      await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { pendingReminder: false, reminderPreference: "none" } });
      return { action: "reminder_declined", reply: "Okay, no reminder. Anything else? Send MENU for options." };
    }
    return { action: "needs_reminder_preference", reply: "Choose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders" };
  }

  if (idleConversation && sessionValid && session!.pendingFeedbackAppointmentId) {
    const rating = /^\s*([1-5])\s*$/.exec(text)?.[1];
    const appointmentId = String(session!.pendingFeedbackAppointmentId);
    const patch: Record<string, unknown> = { feedbackReceivedAt: new Date() };
    if (rating) patch.feedbackRating = Number(rating);
    else patch.feedbackComment = text.slice(0, 1000);
    await AppointmentModel.updateOne({ _id: appointmentId, salonId, customerId: String(customer._id) }, { $set: patch }, { runValidators: true });
    await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { pendingFeedbackAppointmentId: null, expiresAt: sessionExpiry() } });
    if (rating && Number(rating) <= 3) {
      await NotificationModel.create({ salonId, staffId: null, title: "Low WhatsApp feedback", body: `${customer.name || phone} rated appointment ${appointmentId} ${rating}/5. Follow up quickly.`, status: "unread" });
      await tagCustomerLead(salonId, phone, ["service_recovery", "negative_feedback"]);
      return { action: "feedback_captured", reply: "Thanks for telling us. I'm sorry it wasn't perfect — the owner has been notified and we'll follow up." };
    }
    if (rating && Number(rating) >= 4) {
      const settings = await loadWhatsAppPolicySettings(salonId);
      const review = settings.googleReviewUrl ? `\nReview link: ${settings.googleReviewUrl}` : "";
      await tagCustomerLead(salonId, phone, ["happy_customer", "rebook_candidate"]);
      return { action: "feedback_captured", reply: `Thank you! We're glad you liked it. If you have a minute, please share a review on Google — it really helps us.${review}\n\nWant to rebook in a few weeks? Send REBOOK anytime.` };
    }
    return { action: "feedback_captured", reply: "Thank you for the feedback. I've shared it with the salon team." };
  }

  if (idleConversation && /^(book|claim|yes|confirm)$/i.test(lower)) {
    const offered = await WaitlistModel.findOne({ salonId, customerPhone: phone, status: "offered", notified: true, opportunityExpiresAt: { $gt: new Date() } }).sort({ opportunityExpiresAt: -1 });
    const appointment = offered?.offeredAppointmentId ? await AppointmentModel.findOne({ _id: offered.offeredAppointmentId, salonId, status: "pending" }) : null;
    if (offered && appointment) {
      const deposit = await applyDepositToAppointment({ salonId, branchId: appointment.branchId, appointmentId: String(appointment._id), valuePaise: appointment.value, customerName: appointment.customerName || customer.name || phone, customerPhone: phone });
      if (deposit.applied) {
        await WhatsAppBookingSessionModel.findOneAndUpdate({ salonId, waPhone: phone }, { $set: { branchId: appointment.branchId, state: "awaiting_payment", holdAppointmentId: String(appointment._id), expiresAt: sessionExpiry() } }, { upsert: true });
        return { action: "waitlist_claim_payment", appointment: { id: String(appointment._id) }, reply: `Great — that waitlist slot is held for you. Complete the payment link I sent to confirm it.` };
      }
      appointment.status = "confirmed";
      appointment.holdExpiresAt = null;
      await appointment.save();
      await WaitlistModel.updateOne({ _id: offered._id }, { $set: { status: "booked" } });
      await WhatsAppBookingSessionModel.findOneAndUpdate({ salonId, waPhone: phone }, { $set: { branchId: appointment.branchId, state: "menu", holdAppointmentId: String(appointment._id), pendingReminder: true, expiresAt: sessionExpiry() } }, { upsert: true });
      return { action: "waitlist_claimed", appointment: { id: String(appointment._id) }, reply: `Booked. Your waitlist slot for ${appointment.serviceNames.join(", ")} is confirmed.\nChoose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders` };
    }
  }

  if (sessionValid && session!.state === "confirm_hold" && /\b(waitlist|wait list|waiting list|notify me)\b/.test(lower)) {
    const waitlistDate = session!.date || "";
    await WaitlistModel.findOneAndUpdate(
      { salonId, customerId: String(customer._id), status: "waiting", serviceIds: session!.serviceIds || [], date: waitlistDate },
      {
        $setOnInsert: {
          branchId: session!.branchId,
          staffId: session!.staffId || "",
          serviceNames: session!.serviceNames || [],
          preferredTime: session!.startAt ? new Intl.DateTimeFormat("en-GB", { timeZone: loadEnv().SALON_TIMEZONE || "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(session!.startAt)) : "",
          customerPhone: phone,
          notified: false
        }
      },
      { upsert: true }
    );
    await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { state: "menu", earliestOffer: "", lastAlternates: "", expiresAt: sessionExpiry() } });
    return { action: "waitlist_added", reply: `You're on the waitlist for ${(session!.serviceNames || []).join(", ") || "that service"}${waitlistDate ? ` on ${displayDate(waitlistDate)}` : ""}. I'll message you if a spot opens. Send MENU anytime.` };
  }

  if (sessionValid && session!.state === "confirm_hold" && session!.lastAlternates && isCorrectionIntent(lower)) {
    const exchanged = await exchangeToNextAlternate(salonId, session!);
    if (exchanged) {
      if ("exhausted" in exchanged && exchanged.exhausted) {
        await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: phone }, { $set: { lastAlternates: "" } });
        return { action: "no_more_alternates", reply: "That's all I have for that request. Send another date/time or service, or MENU." };
      }
      if ("patch" in exchanged) {
        session = await WhatsAppBookingSessionModel.findOneAndUpdate({ salonId, waPhone: phone }, { $set: exchanged.patch }, { new: true, runValidators: true });
        return {
          action: "booking_proposal",
          reply: exchanged.reply,
          interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }])
        };
      }
    }
  }

  if (isAppointmentCancelIntent(lower) && !(sessionValid && session!.state === "confirm_cancel")) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, "cancel");
  }
  if (isAppointmentRescheduleIntent(lower) && !activeBookingState) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, "reschedule");
  }
  if (isAppointmentModifyIntent(lower) && !activeBookingState && !(sessionValid && isManagementState(session!.state))) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, "modify");
  }
  if (isViewBookingsIntent(lower) && !activeBookingState) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, "view_bookings");
  }
  if (isHelpIntent(lower)) {
    return { action: "help", reply: "I can help you book, view, cancel, reschedule, modify, or rebook appointments. Send MENU to see options." };
  }
  if (isStopFlowIntent(lower) && activeBookingState) {
    session!.state = "cancelled";
    session!.managementAction = null;
    session!.expiresAt = sessionExpiry();
    await session!.save();
    return { action: "booking_aborted", reply: "Okay, I stopped this flow. Send MENU anytime for options." };
  }
  if (sessionValid && (session!.managementAction || isManagementState(session!.state)) && !(session!.state === "menu" && (BOOKING_KEYWORDS.some((keyword) => lower === keyword || lower.includes(keyword)) || SALON_SERVICE_SIGNAL.test(lower)))) {
    return handleManagementState({ salonId, branchId, phone, customer, session: session!, branches, text, lower, message }, null);
  }
  const managementCommand = managementIntent(lower, ai);
  if (managementCommand && !activeBookingState) {
    return handleManagementState({ salonId, branchId, phone, customer, session: sessionValid ? session : null, branches, text, lower, message }, managementCommand);
  }

  const extremeTz = loadEnv().SALON_TIMEZONE || "Asia/Kolkata";

  // E1: one-message booking — "book a haircut tomorrow 3pm with Dev" lands on a single CONFIRM.
  // Multi-service: "book a Classic Haircuts 001 and Express Haircuts 002 tomorrow 3pm" proposes both.
  const oneMessageBooking = async (): Promise<Record<string, unknown> | null> => {
    const aiBranch = ai.branch ? branches.find((branch) => branch.name.toLowerCase() === ai.branch!.toLowerCase() || branch.name.toLowerCase().includes(ai.branch!.toLowerCase())) : null;
    const targetBranchId = (branchMatch || aiBranch)?._id || (branches.length === 1 ? branches[0]!._id : branchId);
    const services = await ServiceModel.find(branchServiceFilter(salonId, targetBranchId)).select("name pricePaise durationMinutes eligibleStaffIds category").sort({ name: 1 });
    const lowerKey = normalizedNameKey(lower);
    let matches: (typeof services)[number][] = [];
    for (const item of services) {
      const key = normalizedNameKey(item.name);
      if (key.length >= 4 && lowerKey.includes(key)) matches.push(item);
    }
    matches = matches.filter((item) => !matches.some((other) => other !== item && normalizedNameKey(other.name).length > normalizedNameKey(item.name).length && normalizedNameKey(other.name).includes(normalizedNameKey(item.name))));
    if (matches.length > 4) matches = matches.slice(0, 4);
    if (!matches.length && ai.service) {
      const match = fuzzyClosestName(services.map((item) => item.name), ai.service);
      if (match && !match.ambiguous) matches = services.filter((item) => item.name === match.name);
    }
    if (!matches.length) {
      const direct = services.filter((item) => lower === item.name.toLowerCase() || lower.includes(item.name.toLowerCase()));
      if (direct.length) matches = direct.slice(0, 4);
    }
    if (!matches.length) {
      const resolved = await resolveServiceIntents({ text, salonId, branchId: targetBranchId });
      if (resolved.ambiguousNames.length) return null;
      if (resolved.matched.length) matches = resolved.matched.slice(0, 4).map((entry) => entry.service as (typeof services)[number]);
    }
    if (!matches.length) return null;
    const summary = summarizeServices(matches);
    const duration = summary.duration;
    const eligible = await eligibleStaffForServices(salonId, targetBranchId, matches);
    if (!eligible.length) return null;
    const dateInput = parseNaturalDate(text, extremeTz);
    const preference = parseTimePreference(text);
    const setPartialBooking = async (patch: Record<string, unknown>): Promise<void> => {
      session = await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        {
          $set: {
            branchId: targetBranchId,
            profileName: message.profileName,
            managementAction: null,
            targetAppointmentId: null,
            modifyField: null,
            category: matches[0]!.category || null,
            categoryPage: 0,
            servicePage: 0,
            staffPage: 0,
            serviceId: String(matches[0]!._id),
            serviceName: matches[0]!.name,
            serviceIds: matches.map((item) => String(item._id)),
            serviceNames: matches.map((item) => item.name),
            durationMinutes: duration,
            value: summary.value,
            availableSlots: [],
            staffId: eligible[0]!.staffId,
            holdAppointmentId: null,
            customerName: message.profileName || "",
            expiresAt: sessionExpiry(),
            ...patch
          }
        },
        { upsert: true, new: true }
      );
      await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
    };
    if (!dateInput) {
      await setPartialBooking({ state: "select_date", date: null, startAt: null });
      return { action: "needs_date", reply: `${summary.names.join(" + ")} selected. What day and time works for you? Try "tomorrow evening" or "Friday 5pm".` };
    }
    if (dateInput < new Date(new Date().toLocaleString("en-US", { timeZone: extremeTz })).toLocaleDateString("en-CA")) return null;
    if (preference.time == null && preference.after == null && preference.before == null && preference.flexible !== true) {
      const slots = await suggestedSlots(salonId, targetBranchId, eligible[0]!.staffId, dateInput, duration, undefined, 12);
      if (!slots.length) return { action: "no_slots", reply: `No slots are available on ${displayDate(dateInput)}. Send another day, or MENU.` };
      await setPartialBooking({ state: "select_time", date: dateInput, availableSlots: slots, startAt: null });
      return { action: "date_selected", reply: `${summary.names.join(" + ")} selected for ${displayDate(dateInput)}. Available slots:\n${formatOptions(slots.map((slot) => slot.label))}\nReply with a time, or say morning/evening.` };
    }
    const handStaff = text.match(/\b(?:with|under|by)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\b/i);
    let eligibleForSearch = eligible;
    if (handStaff) {
      const match = fuzzyClosestName(eligible.map((item) => item.name), handStaff[1]!.trim().replace(/\.$/, ""));
      if (match && !match.ambiguous) {
        const pickedStaff = eligible.find((item) => item.name === match.name);
        if (pickedStaff) eligibleForSearch = [pickedStaff, ...eligible.filter((item) => item.staffId !== pickedStaff.staffId)];
      }
    }
    const options = await smartSlotOptions({ salonId, branchId: targetBranchId, staff: eligibleForSearch, date: dateInput, durationMinutes: duration, preference, limit: 3 });
    if (!options.length) {
      await WaitlistModel.findOneAndUpdate(
        { salonId, customerId: String(customer._id), status: "waiting", serviceIds: matches.map((item) => String(item._id)), date: dateInput },
        { $setOnInsert: { branchId: targetBranchId, staffId: eligibleForSearch[0]?.staffId || "", serviceNames: matches.map((item) => item.name), preferredTime: preference.time || "", customerPhone: phone, notified: false } },
        { upsert: true }
      );
      return { action: "waitlist_added", reply: `No free slots matched ${displayDate(dateInput)}${preference.time ? ` around ${preference.time}` : ""}. I added you to the waitlist for ${summary.names.join(", ")}.\nSend another day/time, or I'll message you if a spot opens.` };
    }
    const firstOption = options[0]!;
    const alternates = JSON.stringify({
      text: text.slice(0, 200),
      branchId: targetBranchId,
      date: dateInput,
      preference: { time: preference.time ?? null, after: preference.after ?? null, before: preference.before ?? null, flexible: preference.flexible === true },
      services: matches.map((item) => item.name),
      staffs: eligibleForSearch.map((item) => ({ staffId: item.staffId, name: item.name })),
      slots: options.map((slot) => ({ label: slot.label, startAt: slot.startAt.toISOString() })),
      pick: { staff: eligibleForSearch.findIndex((item) => item.staffId === firstOption.staffId), slot: 0 }
    });
    const offer = offerFromSmartOptions({ branchId: targetBranchId, date: dateInput, services: matches.map((item) => ({ id: String(item._id), name: item.name, durationMinutes: item.durationMinutes, pricePaise: item.pricePaise, eligibleStaffIds: item.eligibleStaffIds })), summary, options, preference });
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId, waPhone: phone },
      {
        $set: {
          branchId: targetBranchId,
          profileName: message.profileName,
          state: "confirm_hold",
          managementAction: null,
          targetAppointmentId: null,
          modifyField: null,
          category: matches[0]!.category || null,
          categoryPage: 0,
          servicePage: 0,
          staffPage: 0,
          serviceId: String(matches[0]!._id),
          serviceName: matches[0]!.name,
          serviceIds: matches.map((item) => String(item._id)),
          serviceNames: matches.map((item) => item.name),
          durationMinutes: duration,
          value: summary.value,
          availableSlots: [],
          date: dateInput,
          startAt: new Date(firstOption.startAt),
          staffId: firstOption.staffId,
          holdAppointmentId: null,
          customerName: message.profileName || "",
          lastAlternates: alternates,
          earliestOffer: offer,
          expiresAt: sessionExpiry()
        }
      },
      { upsert: true, new: true }
    );
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
    return {
      action: "booking_proposal",
      reply: `I found these for ${summary.names.join(" + ")} on ${displayDate(dateInput)}:\n${formatOptions(options.map((slot) => `${slot.label} with ${slot.staffName}`))}\nReply 1-${options.length}, CONFIRM to book option 1, WAITLIST, or CANCEL. Total: ${money(summary.value)}, ${duration} minutes.`,
      interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }])
    };
  };

  // E5b: memory booking — "book my usual / same as last time tomorrow 3pm" uses
  // the customer's recorded favourites instead of parsing a service name.
  const memoryBookingSignal = /same as last time|same as before|same as my last|my usual|usual service|like last time|last time wala|jaisa pehle|vaise hi|vahi service|favourite service|favorite service/.test(lower);
  const memoryBooking = async (): Promise<Record<string, unknown> | null> => {
    if (!memoryBookingSignal || !idleConversation) return null;
    const favouriteIds = (customer.favoriteServiceIds || []).map(String);
    if (!favouriteIds.length || !Number(customer.visitCount || 0)) return null;
    const targetBranchId = (branchMatch || (branches.length === 1 ? branches[0] : null))?._id || branchId;
    const services = await ServiceModel.find({
      _id: { $in: favouriteIds },
      salonId,
      status: "active",
      $or: [{ branchIds: targetBranchId }, { branchIds: { $size: 0 } }]
    }).select("name category pricePaise durationMinutes eligibleStaffIds").sort({ name: 1 }).limit(4);
    if (!services.length) return null;
    const dateInput = parseNaturalDate(text, extremeTz);
    const preference = parseTimePreference(text);
    if (!dateInput || preference.time == null && preference.after == null && preference.before == null && preference.flexible !== true) {
      const summary = summarizeServices(services);
      await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        {
          $set: {
            branchId: targetBranchId,
            profileName: message.profileName,
            state: "select_date",
            managementAction: null,
            serviceId: String(services[0]!._id),
            serviceName: services[0]!.name,
            serviceIds: services.map((service) => String(service._id)),
            serviceNames: services.map((service) => service.name),
            durationMinutes: summary.duration,
            value: summary.value,
            date: null,
            startAt: null,
            staffId: null,
            expiresAt: sessionExpiry()
          }
        },
        { upsert: true, new: true }
      );
      return { action: "usual_needs_time", reply: `Your usual is ${summary.names.join(" + ")} (${money(summary.value)}, ${summary.duration} minutes). What day/time should I check? Try "tomorrow evening" or "Friday 5pm".` };
    }
    if (dateInput < new Date(new Date().toLocaleString("en-US", { timeZone: extremeTz })).toLocaleDateString("en-CA")) return null;
    const summary = summarizeServices(services);
    const eligible = await eligibleStaffForServices(salonId, targetBranchId, services);
    if (!eligible.length) return null;
    const resolveSlots = async (staffId: string): Promise<Array<{ label: string; startAt: Date }>> => {
      const slots = await suggestedSlots(salonId, targetBranchId, staffId, dateInput, summary.duration, undefined, 96);
      if (!slots.length) return [];
      const narrowed = filterSlotsByPreference(slots, preference);
      return (narrowed.length ? narrowed : slots).slice(0, 4);
    };
    const preferredStaff = (customer.preferredStaffIds || []).map(String).find((staffId) => eligible.some((staff) => staff.staffId === staffId));
    let staffPick: { staffId: string; name: string } | null = null;
    let pickedSlots: Array<{ label: string; startAt: Date }> = [];
    if (preferredStaff) {
      const staff = eligible.find((entry) => entry.staffId === preferredStaff);
      if (staff) {
        const slots = await resolveSlots(staff.staffId);
        if (slots.length) { staffPick = staff; pickedSlots = slots; }
      }
    }
    if (!staffPick) {
      for (const staff of eligible) {
        const slots = await resolveSlots(staff.staffId);
        if (slots.length) { staffPick = staff; pickedSlots = slots; break; }
      }
    }
    if (!staffPick || !pickedSlots.length) return null;
    const slotPick = pickedSlots[0]!;
    session = await WhatsAppBookingSessionModel.findOneAndUpdate(
      { salonId, waPhone: phone },
      {
        $set: {
          branchId: targetBranchId,
          profileName: message.profileName,
          state: "confirm_hold",
          managementAction: null,
          targetAppointmentId: null,
          modifyField: null,
          category: services[0]!.category || null,
          categoryPage: 0,
          servicePage: 0,
          staffPage: 0,
          serviceId: String(services[0]!._id),
          serviceName: services[0]!.name,
          serviceIds: services.map((service) => String(service._id)),
          serviceNames: services.map((service) => service.name),
          durationMinutes: summary.duration,
          value: summary.value,
          availableSlots: [],
          date: dateInput,
          startAt: new Date(slotPick.startAt),
          staffId: staffPick.staffId,
          holdAppointmentId: null,
          customerName: message.profileName || "",
          lastAlternates: "",
          earliestOffer: "",
          expiresAt: sessionExpiry()
        }
      },
      { upsert: true, new: true }
    );
    await CustomerModel.updateOne({ salonId, normalizedPhone: phone }, { $set: { interactionStatus: "booking_started" } });
    return {
      action: "booking_proposal",
      reply: `Your usual — ${summary.names.join(" + ")} on ${displayDate(dateInput)} at ${slotPick.label} with ${staffPick.name}. Total: ${money(summary.value)}, ${summary.duration} minutes.\nReply CONFIRM to book, or CANCEL to change your mind.`,
      interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }])
    };
  };

  const naturalBookingSignal = BOOKING_KEYWORDS.some((keyword) => lower === keyword || lower.includes(keyword)) || SALON_SERVICE_SIGNAL.test(lower);
  const extremeBookingGate = !activeBookingState && !(sessionValid && session!.state !== "menu" && isManagementState(session!.state)) && naturalBookingSignal;
  if (extremeBookingGate) {
    const proposal = await oneMessageBooking();
    if (proposal) return proposal;
  }
  if (memoryBookingSignal) {
    const proposal = await memoryBooking();
    if (proposal) return proposal;
  }

  if (!session || session.expiresAt < new Date() || BOOKING_KEYWORDS.includes(lower)) {
    const hasBookingIntent = BOOKING_KEYWORDS.some((keyword) => lower === keyword || lower.includes(keyword)) || SALON_SERVICE_SIGNAL.test(lower) || (ai.isSalonRelated !== false && (ai.intent === "BOOK_APPOINTMENT" || ai.intent === "SERVICES" || ai.intent === "PRICES"));
    if (!session) {
      // Brand-new chat: when the WhatsApp booking Flow is configured, greet with the
      // native one-form booking flow and the full menu immediately (no gate tap).
      // Otherwise route through the two-choice gate; explicit booking requests were
      // already handled above by oneMessageBooking.
      const repeatGreeting = Number(customer.visitCount || 0) > 1 ? `Welcome back${customer.name ? `, ${customer.name}` : ""}! Want the usual or something new?\n\n` : "Hi! I can help you book or manage your appointments.\n\n";
      const flowInteractive = await bookingFlowInteractive(salonId, phone, branches, `${repeatGreeting}Choose department, branch, date and time in one smooth WhatsApp form.`);
      session = await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        { $set: { state: flowInteractive ? "menu" : "gate", managementAction: null, targetAppointmentId: null, modifyField: null, categoryPage: 0, servicePage: 0, staffPage: 0, expiresAt: sessionExpiry() } },
        { upsert: true, new: true }
      );
      if (flowInteractive) {
        const followUp = mainMenuPayload();
        return { ...followUp, action: "booking_flow", reply: `${repeatGreeting}Tap below to book your appointment in one smooth WhatsApp form.`, interactive: flowInteractive, followUp: { ...followUp, action: "menu" } };
      }
      return gatePayload(repeatGreeting);
    }
    if (!hasBookingIntent) {
      const conciergeReply = await concierge();
      if (conciergeReply) return conciergeReply;
      const greeting = !session ? "Hi! I can help you book or manage your appointments.\n\n" : "";
      session = await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        { $set: { state: "menu", managementAction: null, targetAppointmentId: null, modifyField: null, expiresAt: sessionExpiry() } },
        { upsert: true, new: true }
      );;
      return { ...mainMenuPayload(), reply: greeting + "Main menu — what would you like to do?\n1. Book appointment\n2. View my bookings\n3. View history\n4. Reschedule booking\n5. Modify booking\n6. Cancel booking\n7. Rebook a service" };
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
    const flowInteractive = await bookingFlowInteractive(salonId, phone, branches);
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
    const resolvedBranch = resolveBranchIntent(text, branches);
    const selected = branches[index] || branches.find((branch) => branch._id === text) || branchMatch || (resolvedBranch ? branches.find((branch) => String(branch._id) === String(resolvedBranch!.branchId)) : undefined);
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
        const synonyms = await resolveServiceIntents({ text, salonId, branchId: session.branchId });
        if (synonyms.matched.length && !synonyms.ambiguousNames.length) {
          const list = synonyms.matched.slice(0, WHATSAPP_PAGE_SIZE).map((entry) => ({ _id: entry.service._id, name: entry.service.name, pricePaise: entry.service.pricePaise }));
          session.searchQuery = directQuery;
          session.category = null;
          session.servicePage = 0;
          session.state = "select_service";
          session.expiresAt = sessionExpiry();
          await session.save();
          return { action: "search_results", reply: pageReply(`Found matching services for "${directQuery}":`, list.map((s) => `${s.name} - ${money(s.pricePaise)}`), false), interactive: listInteractive("Choose a service:", "Services", list.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) }))) };
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
    if (lower === "back") {
      const filter = session.searchQuery ? serviceSearchFilter(salonId, session.branchId, session.searchQuery) : branchServiceFilter(salonId, session.branchId, session.category ? { category: session.category } : {});
      const services = await ServiceModel.find(filter).sort({ name: 1 });
      if ((session.servicePage || 0) > 0) {
        session.servicePage = (session.servicePage || 0) - 1;
        session.expiresAt = sessionExpiry();
        await session.save();
        const prevPage = pagedOptions(services, session.servicePage);
        return { action: "service_page", reply: pageReply("Previous services:", prevPage.pageItems.map((s) => `${s.name} - ${money(s.pricePaise)}`), prevPage.hasNext), interactive: listInteractive("Choose a service:", "Services", [...prevPage.pageItems.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(prevPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
      }
      session.state = "select_category";
      session.expiresAt = sessionExpiry();
      await session.save();
      const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((s) => s.category || "Services"))];
      const categoryPage = pagedOptions(categories, session.categoryPage || 0);
      return { action: "category_selected", reply: pageReply("Choose a service category:", categoryPage.pageItems, categoryPage.hasNext), interactive: listInteractive("Choose a category:", "Categories", [...categoryPage.pageItems.map((c) => ({ id: c, title: c })), ...(categoryPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
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
    let selected = page.pageItems[index] || services.find((service) => String(service._id) === text || service.name.toLowerCase() === lower || lower.includes(service.name.toLowerCase()) || (ai.service && service.name.toLowerCase().includes(ai.service.toLowerCase())));
    if (!selected && directSearchInput(text)) {
      const resolved = await resolveServiceIntents({ text, salonId, branchId: session.branchId });
      if (resolved.matched.length && !resolved.ambiguousNames.length) {
        selected = resolved.matched[0]!.service as (typeof services)[number];
        session.searchQuery = "";
      }
    }
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
    const related = selected.category
      ? await ServiceModel.findOne({ ...branchServiceFilter(salonId, session.branchId, { category: selected.category }), _id: { $ne: selected._id } }).sort({ pricePaise: 1 }).lean()
      : null;
    const upsell = related ? `\nPopular add-on: ${related.name} (${money(related.pricePaise)}, ${related.durationMinutes} min). Type its name to add, or DONE.` : "";
    return { action: "service_selected", service: selected.name, reply: `${selected.name} added.\n${summary.label}${upsell}\nAdd another service? Reply YES, type another service name, or DONE.` };
  }

  if (session.state === "add_more_services") {
    const removeIntent = removeServiceIntent(text);
    if (removeIntent) return await removeDraftServices(session, removeIntent, async (patch) => { Object.assign(session, patch, { expiresAt: sessionExpiry() }); await session.save(); return session; }, salonId);
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
      if (!services.length) {
        const synonyms = await resolveServiceIntents({ text, salonId, branchId: session.branchId });
        if (synonyms.matched.length && !synonyms.ambiguousNames.length) {
          const list = synonyms.matched.slice(0, WHATSAPP_PAGE_SIZE).map((entry) => ({ _id: entry.service._id, name: entry.service.name, pricePaise: entry.service.pricePaise }));
          return { action: "search_results", reply: pageReply(`Found matching services for "${searchQuery}":`, list.map((s) => `${s.name} - ${money(s.pricePaise)}`), false), interactive: listInteractive("Choose a service:", "Services", list.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) }))) };
        }
        return { action: "search_empty", reply: `No services found for "${searchQuery}". Reply YES to browse categories or DONE for staff.` };
      }
      return { action: "search_results", reply: pageReply(`Search results for "${searchQuery}":`, services.map((s) => `${s.name} - ${money(s.pricePaise)}`), hasNext), interactive: listInteractive("Choose a service:", "Services", [...services.map((s) => ({ id: String(s._id), title: s.name.slice(0, 24), description: money(s.pricePaise) })), ...(hasNext ? [{ id: "more", title: "More" }] : [])]) };
    }
    if (!isDoneInput(text)) return { action: "needs_add_more", reply: "Reply YES to add another service, type a service name to search, or DONE to choose staff." };
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds });
    const staff = await eligibleStaffForServices(salonId, session.branchId, services);
    if (!staff.length) return { action: "no_staff", reply: `No staff can perform all selected services together at this branch (${(session.serviceNames || []).join(" + ")}). Remove one service, choose a different branch, or start again with 'book appointment'.` };
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
    const fallbackStaff = resolveStaffIntent(text, staff);
    const selected = page.pageItems[Number(text) - 1] || staff.find((item) => item.staffId === text || item.name.toLowerCase() === lower || item.name.toLowerCase().includes(lower)) || (fallbackStaff ? staff.find((item) => item.staffId === fallbackStaff!.staffId) : undefined);
    if (!selected) return { action: "needs_staff", reply: pageReply("Please choose a valid staff member.", page.pageItems.map((item) => item.name), page.hasNext) };
    session.staffId = selected.staffId;
    session.state = "select_date";
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "staff_selected", reply: `${selected.name} selected. Please send appointment date as YYYY-MM-DD.` };
  }

  if (session.state === "select_date") {
    if (isAcceptOfferIntent(lower) && session.serviceNames?.length) return { action: "needs_date", reply: `${session.serviceNames.join(" + ")} selected. What day/time should I check? Try "tomorrow evening" or "Friday 5pm".` };
    const dateInput = parseNaturalDate(ai.date || text) || null;
    if (!dateInput) return { action: "needs_date", reply: "Please send a date like tomorrow, Friday, or YYYY-MM-DD." };
    if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
    if (!session.staffId) return { action: "needs_staff", reply: "Please choose staff before selecting a date." };
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, summary.duration);
    if (!slots.length) {
      const next = await nextAvailableDates(salonId, session.branchId, session.staffId, summary.duration, dateInput);
      const hint = next.length ? ` Free on: ${next.map(displayDate).join(", ")}.` : "";
      return { action: "no_slots", reply: `No slots are available for the selected staff on ${displayDate(dateInput)}.${hint} Send another date.` };
    }
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
    const picked = pickBestSlot(session.availableSlots || [], text);
    let timeInput = "";
    if (picked.candidate) {
      timeInput = picked.candidate.label;
    } else {
      const candidates = picked.candidates || [];
      if (candidates.length) {
        if (lower === "back") {
          session.state = "select_date";
          session.date = null;
          session.expiresAt = sessionExpiry();
          await session.save();
          return { action: "needs_date", reply: "Please send the date like tomorrow, Friday, or YYYY-MM-DD." };
        }
        if (/\d{1,2}(?:\s*(?:am|pm)|:)/.test(text)|| /\b(morning|afternoon|evening|night|noon)\b/.test(lower)) {
          return { action: "needs_time", reply: `I found a few options around that time:\n${formatOptions(candidates.map((slot) => slot.label))}\nReply with one.` };
        }
      }
      timeInput = normalizeTimeInput(ai.time || text);
      if (!/^\d{2}:\d{2}$/.test(timeInput)) return { action: "needs_time", reply: "Please send a time like 3pm or HH:mm." };
    }
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const [hour, minute] = timeInput.split(":").map(Number);
    const startAt = zonedTimeToUtc(timezone, session.date || "", hour || 0, minute || 0);
    if (Number.isNaN(startAt.getTime())) return { action: "needs_time", reply: "Invalid time. Please send a time like 3pm or HH:mm." };
    const rescheduleTarget = session.holdAppointmentId ? await AppointmentModel.findOne({ _id: session.holdAppointmentId, salonId, customerId: String(customer._id), status: { $in: ["booked", "confirmed"] } }) : null;
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const endAt = new Date(startAt.getTime() + summary.duration * 60_000);
    if (!session.staffId || !(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone }))) {
      const nearby = session.staffId ? await freeNearbySlots(salonId, session.branchId, session.staffId, session.date || "", summary.duration, timeInput) : [];
      const eligible = await eligibleStaffForServices(salonId, session.branchId, services);
      const sameTimeOtherStaff: string[] = [];
      for (const staff of eligible.filter((item) => item.staffId !== session.staffId).slice(0, 5)) {
        if (await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: staff.staffId, startAt, endAt, date: session.date || "", timezone })) sameTimeOtherStaff.push(staff.name);
        if (sameTimeOtherStaff.length >= 3) break;
      }
      if (sameTimeOtherStaff.length) return { action: "slot_unavailable_other_staff", reply: `That time is booked with your selected staff, but ${timeInput} is free with:\n${formatOptions(sameTimeOtherStaff)}\nSend "book ${summary.names[0] || "service"} ${displayDate(session.date || "")} at ${timeInput} with ${sameTimeOtherStaff[0]}", or pick a nearby time:\n${formatOptions(nearby.map((slot) => slot.label))}` };
      if (nearby.length) return { action: "slot_unavailable", reply: `That slot is booked. Free nearby with the same staff:\n${formatOptions(nearby.map((slot) => slot.label))}\nReply with one.` };
      const allOptions = await smartSlotOptions({ salonId, branchId: session.branchId, staff: eligible, date: session.date || "", durationMinutes: summary.duration, preference: null, limit: 3 });
      if (allOptions.length) return { action: "slot_unavailable_alternates", reply: `That slot is no longer available. Closest options I can do:\n${formatOptions(allOptions.map((slot) => `${slot.label} with ${slot.staffName}`))}\nReply with a time or staff name.` };
      return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
    }
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
    return {
      action: "time_selected",
      reply: `${summary.names.join(", ")} is available at ${timeInput}. Total: ${money(summary.value)}, ${summary.duration} minutes. Reply CONFIRM to book this appointment.`,
      interactive: buttonsInteractive("Book this appointment?", [
        { id: "confirm", title: "Confirm" },
        { id: "cancel", title: "Cancel" }
      ])
    };
  }

  if (session.state === "awaiting_payment") {
    const hold = session.holdAppointmentId ? await AppointmentModel.findOne({ _id: session.holdAppointmentId, salonId }).lean() : null;
    if (/(paid|done|completed|i'?ve paid|payment done|paid now)/.test(lower)) {
      if (hold?.status === "confirmed" && hold.paymentStatus === "paid") return { action: "payment_confirmed", reply: "Payment is confirmed and your appointment is booked. Send MENU anytime to manage it." };
      if (hold) {
        const checked = await verifyOrRefreshDepositLink({ salonId, appointmentId: String(hold._id), customerName: hold.customerName || customer.name || phone, customerPhone: phone });
        if (checked.status === "paid") {
          session.state = "menu";
          session.pendingReminder = true;
          await session.save();
          return { action: "payment_confirmed", reply: "Payment is confirmed and your appointment is booked. Choose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders" };
        }
        if (checked.status === "refreshed" && checked.paymentLink) return { action: "payment_link_refreshed", reply: `The old payment hold expired, so I created a fresh payment link and held the slot again for 30 minutes.\n${checked.paymentLink}`, interactive: buttonsInteractive("Payment options", [{ id: "paid", title: "I've paid" }, { id: "menu", title: "Menu" }]) };
      }
      if (hold?.paymentLink) return { action: "payment_pending", reply: `I don't see the payment confirmed yet. Razorpay can take a minute to notify us.\nIf needed, complete it here again: ${hold.paymentLink}`, interactive: buttonsInteractive("Payment options", [{ id: "paid", title: "I've paid" }, { id: "menu", title: "Menu" }]) };
      return { action: "payment_pending", reply: "I don't see the payment confirmed yet. Please wait a minute and send PAID again, or send MENU to start over." };
    }
    if (hold?.paymentLink) return { action: "awaiting_payment", reply: `Your slot is held. Please complete the Razorpay payment link and I'll confirm automatically after server verification.\n${hold.paymentLink}`, interactive: buttonsInteractive("Payment options", [{ id: "paid", title: "I've paid" }, { id: "menu", title: "Menu" }]) };
    return { action: "awaiting_payment", reply: "Your slot is held. Please complete the Razorpay payment link. I will confirm automatically after server verification." };
  }

  if (session.state === "confirm_hold") {
    if (lower !== "confirm") return { action: "needs_confirm", reply: "Reply CONFIRM to book this appointment, or CANCEL to stop.", interactive: buttonsInteractive("Book this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }]) };
    if ((!session.serviceIds?.length && !session.serviceId) || !session.startAt || !session.staffId) return { action: "invalid_session", reply: "Booking session expired. Send 'Book appointment' again." };
    await expireCustomerHolds(salonId, session.branchId, String(customer._id));
    const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds, serviceId: session.serviceId });
    const summary = summarizeServices(services);
    const endAt = new Date(session.startAt.getTime() + summary.duration * 60_000);
    const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
    const appointment = await AppointmentModel.create({ salonId, branchId: session.branchId, staffId: session.staffId, customerId: String(customer._id), customerName: session.customerName || message.profileName || phone, serviceIds: services.map((service) => service.id), serviceNames: summary.names, durationMinutes: summary.duration, value: summary.value, startAt: session.startAt, endAt, status: "confirmed", source: "whatsapp", paymentStatus: "not_required" });
    try {
      await AppointmentSlotLockModel.create(slotInstants(session.startAt, endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: session.staffId!, appointmentId: String(appointment._id), slotAt })));
    } catch (error) {
      await AppointmentModel.deleteOne({ _id: appointment._id });
      if (isDuplicateKey(error)) return { action: "slot_unavailable", reply: "That slot was just booked by someone else. Please send another date to see fresh slots." };
      throw error;
    }
    publishRealtimeEvent(salonId, "appointment.created", { id: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, startAt: appointment.startAt.toISOString(), endAt: appointment.endAt.toISOString(), status: appointment.status, source: "whatsapp" });
    session.holdAppointmentId = String(appointment._id);
    session.lastAlternates = "";
    session.earliestOffer = "";
    session.expiresAt = sessionExpiry();

    const deposit = await applyDepositToAppointment({
      salonId,
      branchId: session.branchId,
      appointmentId: String(appointment._id),
      valuePaise: appointment.value,
      customerName: appointment.customerName || session.customerName || phone,
      customerPhone: phone
    });

    if (deposit.applied) {
      session.state = "awaiting_payment";
      await session.save();
      void notifyStaffByStaffId(salonId, appointment.staffId, {
        title: "New appointment (awaiting deposit)",
        body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: timezone })}`,
        tag: `appointment-${String(appointment._id)}`,
        data: { appointmentId: String(appointment._id), type: "appointment.created" }
      });
      return { action: "awaiting_payment", appointment: { id: String(appointment._id) }, reply: `Your slot is held while we process the advance deposit.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName: await staffNameOf(salonId, session.staffId!), branchName: branch?.name || session.branchId, startAt: session.startAt, timezone, durationMinutes: summary.duration, value: summary.value })}\nComplete the payment link I just sent. The slot will be released in 30 minutes if not paid.` };
    }

    session.state = "menu";
    session.pendingReminder = true;
    await session.save();
    void notifyStaffByStaffId(salonId, appointment.staffId, {
      title: "New appointment",
      body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: timezone })}`,
      tag: `appointment-${String(appointment._id)}`,
      data: { appointmentId: String(appointment._id), type: "appointment.created" }
    });
    await recordCustomerBooking(salonId, phone, { staffId: appointment.staffId, serviceIds: appointment.serviceIds, startAt: appointment.startAt });
    const staffTitle = await staffNameOf(salonId, session.staffId!);
    return {
      action: "appointment_created",
      appointment: { id: String(appointment._id) },
      reply: withSuccessTip(`Your appointment is booked.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName: staffTitle, branchName: branch?.name || session.branchId, startAt: session.startAt, timezone, durationMinutes: summary.duration, value: summary.value })}\nChoose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders`)
    };
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
    await recordCustomerBooking(salonId, phone, { staffId: hold.staffId, serviceIds: (hold.serviceIds || []).map(String), startAt: hold.startAt });
    session.state = "menu";
    session.pendingReminder = true;
    session.expiresAt = sessionExpiry();
    await session.save();
    return { action: "appointment_created", appointment: { id: String(hold._id) }, reply: withSuccessTip(`Your appointment is confirmed.\nService: ${hold.serviceNames.join(", ")}\nDate: ${hold.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\nPrice: ${money(hold.value)}\nChoose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders`) };
  }

  if (session.state === "gate") {
    const menuAction = menuActionFor(text);
    if (menuAction === "book_appointment" || menuAction === "book" || lower === "book" || lower === "1") {
      session.state = "cancelled";
      session.managementAction = null;
      session.expiresAt = sessionExpiry();
      await session.save();
      return await startBookingFromMenuIn({ salonId, branchId, branches, message, phone });
    }
    if (menuAction === "menu" || lower === "menu" || lower === "2") {
      session = await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId, waPhone: phone },
        { $set: { state: "menu", managementAction: null, targetAppointmentId: null, modifyField: null, expiresAt: sessionExpiry() } },
        { upsert: true, new: true }
      );
      return mainMenuPayload();
    }
    return gatePayload("Welcome! What would you like to do?\n\n");
  }

  const conciergeReply = await concierge();
  if (conciergeReply) return conciergeReply;

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
  if (["menu", "main menu", "options", "help", "back_to_menu"].includes(lower)) return "menu";
  if (["view_bookings", "my bookings", "my booking", "view bookings", "upcoming", "upcoming bookings", "my appointments", "see bookings", "bookings"].includes(lower) || isViewBookingsIntent(lower)) return "view_bookings";
  if (["view_history", "history", "view history", "past bookings", "my history", "previous bookings", "old bookings"].includes(lower) || /(past|history|completed) bookings?/.test(lower)) return "view_history";
  if (ai.intent === "CANCEL_APPOINTMENT" || ["cancel_booking", "cancel", "cancle", "cncel", "cancel booking", "cancel my appointment", "cancel appointment"].includes(lower) || isAppointmentCancelIntent(lower)) return "cancel";
  if (ai.intent === "RESCHEDULE_APPOINTMENT" || ["reschedule_booking", "reschedule", "reschedul", "reshedul", "reschedule booking"].includes(lower) || isAppointmentRescheduleIntent(lower)) return "reschedule";
  if (["modify_booking", "modify", "modfy", "modifiy", "modify booking", "modify my booking", "modify appointment"].includes(lower) || isAppointmentModifyIntent(lower)) return "modify";
  if (["rebook_service", "rebook", "same again", "book again", "repeat", "repeat booking", "book previous", "rebook service"].includes(lower) || /rebook|same again|book (that|it|again)/.test(lower)) return "rebook";
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

/** Two-choice entry gate shown to a brand-new chat. Book goes straight into the
 *  booking flow; Menu opens the full management menu (modify/reschedule/cancel). */
function gatePayload(greeting = ""): Record<string, unknown> {
  return {
    action: "gate",
    reply: `${greeting}Welcome! What would you like to do?\n1. Book appointment\n2. Menu`,
    interactive: buttonsInteractive("What would you like to do?", [
      { id: "book_appointment", title: "Book appointment" },
      { id: "menu", title: "Menu" }
    ])
  };
}

/** Standardized booking summary for confirmations (requirement: service/staff/date/time/duration/price/Booking ID/status). */
function mainMenuPayload(): Record<string, unknown> {
  return {
    action: "menu",
    reply: "Main menu — what would you like to do?\n1. Book appointment\n2. View my bookings\n3. View history\n4. Reschedule booking\n5. Modify booking\n6. Cancel booking\n7. Rebook a service",
    interactive: listInteractive("Choose an option:", "Menu", [
      { id: "book_appointment", title: "Book appointment" },
      { id: "view_bookings", title: "View my bookings" },
      { id: "view_history", title: "View history" },
      { id: "reschedule_booking", title: "Reschedule booking" },
      { id: "modify_booking", title: "Modify booking" },
      { id: "cancel_booking", title: "Cancel booking" },
      { id: "rebook_service", title: "Rebook a service" }
    ])
  };
}

function bookingSummaryLines(opts: { bookingId: string; serviceNames: string[]; staffName: string; branchName: string; startAt: Date; timezone: string; durationMinutes: number; value: number; status?: string }): string {
  const lines = [
    `Booking ID: ${opts.bookingId}`,
    `Services: ${opts.serviceNames.join(", ") || "—"}`,
    `Staff: ${opts.staffName}`,
    `Branch: ${opts.branchName}`,
    `Date: ${mgmtTimeLine(opts.startAt, opts.timezone)}`,
    `Duration: ${opts.durationMinutes} minutes`,
    `Price: ${money(opts.value)}`,
    `Status: ${opts.status || "Confirmed"}`
  ];
  return lines.join("\n");
}

/** Post-booking guidance appended to every confirmation so customers know they can
 *  change the date/staff later without hunting through menus. */
function withSuccessTip(reply: string): string {
  return `${reply}\n\nTip: need to move or change this later? Just send CANCEL, RESCHEDULE, or MODIFY and I'll take it from there.`;
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
  logger.error("WhatsApp management handler error", { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : "" });
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
  return AppointmentModel.find({ salonId, customerId, status: { $in: ["completed", "cancelled", "no_show", "expired", "rescheduled"] } }).sort({ startAt: -1 }).limit(limit).lean();
}

async function targetAppointmentFor(salonId: string, customerId: string, session: any): Promise<any> {
  return AppointmentModel.findOne({ _id: session.targetAppointmentId, salonId, customerId: String(customerId) }).lean();
}

async function finishManagementSession(session: any): Promise<void> {
  session.managementAction = null;
  session.modifyField = null;
  session.targetAppointmentId = null;
  session.state = "menu";
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

  const confirmCancelFor = async (appointment: any): Promise<Record<string, unknown>> => {
    const settings = await loadWhatsAppPolicySettings(salonId);
    const remainingHours = hoursUntil(appointment.startAt);
    if (settings.enforceCancellationCutoff && remainingHours < settings.cancellationCutoffHours) {
      return { action: "cancellation_blocked", reply: `This appointment is within the ${settings.cancellationCutoffHours}-hour cancellation cutoff. Please call the salon to cancel manually.` };
    }
    await setSession({ managementAction: "cancel", targetAppointmentId: String(appointment._id), state: "confirm_cancel" });
    const policy = `${remainingHours <= settings.cancellationCutoffHours ? `\nNote: this is within ${settings.cancellationCutoffHours} hours of your appointment, so late-cancellation rules may apply.` : ""}${appointment.depositAmountPaise ? `\nAdvance paid: ${money(appointment.depositAmountPaise)}. ${settings.depositRefundPolicy}` : ""}`;
    return {
      action: "needs_cancel_confirm",
      reply: `Cancel ${(appointment.serviceNames || []).join(", ")} on ${mgmtTimeLine(appointment.startAt, timezone)}?${policy}\nReply CONFIRM to cancel, or CANCEL to back out.`,
      interactive: buttonsInteractive("Cancel this booking?", [
        { id: "confirm", title: "Yes, cancel" },
        { id: "back", title: "Keep booking" }
      ])
    };
  };

  const staffByName = async (bookings: any[]): Promise<Map<string, string>> => {
    const staffIds = [...new Set(bookings.map((booking) => booking.staffId).filter(Boolean) as string[])];
    if (!staffIds.length) return new Map();
    const staffUsers = await UserModel.find({ salonId, staffId: { $in: staffIds } }).select("staffId name").lean();
    return new Map(staffUsers.map((user) => [String(user.staffId), String((user as { name?: string }).name || "")]));
  };

  const enrichStaff = (bookings: any[], map: Map<string, string>): any[] => bookings.map((booking) => ({ ...booking, staffName: map.get(String(booking.staffId)) || "" }));

  const cancelTargetFromMessage = async (): Promise<any | null> => {
    const id = extractBookingId(text);
    if (id) return AppointmentModel.findOne({ _id: id, salonId, customerId, status: { $in: MANAGEMENT_UPCOMING_STATUSES }, startAt: { $gte: new Date() } }).lean();
    const bookings = await upcomingBookings(salonId, customerId, 10);
    if (!bookings.length) return null;
    const enriched = enrichStaff(bookings, await staffByName(bookings));
    const { matched, hasDateHint, hasNameHint } = filterBookingsByHints(enriched, text, timezone);
    return matched.length === 1 && (hasDateHint || hasNameHint) ? matched[0] : null;
  };

  const activeTargetFromMessage = async (): Promise<any | null> => {
    const id = extractBookingId(text);
    if (id) return AppointmentModel.findOne({ _id: id, salonId, customerId, status: { $in: MANAGEMENT_UPCOMING_STATUSES }, startAt: { $gte: new Date() } }).lean();
    const bookings = await upcomingBookings(salonId, customerId, 10);
    if (bookings.length === 1) return bookings[0];
    if (!bookings.length) return null;
    const enriched = enrichStaff(bookings, await staffByName(bookings));
    const { matched, hasDateHint, hasNameHint } = filterBookingsByHints(enriched, text, timezone);
    return matched.length === 1 && (hasDateHint || hasNameHint) ? matched[0] : null;
  };

  const rescheduleDateReply = async (appointment: any, requestedDate: string, clauseInput: string | null = null): Promise<Record<string, unknown>> => {
    const input = clauseInput || text;
    const services = await selectedServices({ salonId, branchId: appointment.branchId, serviceIds: appointment.serviceIds || [] });
    const summary = summarizeServices(services);
    const preference: { time?: string; after?: number; before?: number } = /\bsame time\b/i.test(input)
      ? (() => {
          const local = localMinutes(new Date(appointment.startAt), timezone);
          return { time: `${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}` };
        })()
      : parseTimePreference(input);
    const duration = summary.duration || appointment.durationMinutes || 0;
    const allSlots = await suggestedSlots(salonId, appointment.branchId, appointment.staffId, requestedDate, duration, String(appointment._id), 96);
    const slots = filterSlotsByPreference(allSlots, preference);
    await setSession({ managementAction: "reschedule", targetAppointmentId: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, serviceIds: appointment.serviceIds || [], serviceNames: appointment.serviceNames || [], durationMinutes: duration, value: summary.value || appointment.value || 0, date: requestedDate, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })), state: slots.length ? "reschedule_time" : "reschedule_date" });
    if (!slots.length) {
      const next = await nextAvailableDates(salonId, appointment.branchId, appointment.staffId, duration, requestedDate, String(appointment._id));
      const hint = next.length ? ` Free on: ${next.map(displayDate).join(", ")}.` : "";
      return { action: "no_slots", reply: `No slots are available for ${(preference ? "that time on " : "")}${displayDate(requestedDate)}.${hint} Send another date/time, BACK, or MENU.` };
    }
    return { action: "reschedule_slots", reply: `Available slots on ${displayDate(requestedDate)}:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose new time:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
  };

  const naturalBookingsReply = async (): Promise<Record<string, unknown>> => {
    const bookings = await upcomingBookings(salonId, customerId, 10);
    if (!bookings.length) {
      await setSession({ state: "view_bookings", managementAction: "view_bookings" });
      return { action: "view_bookings", reply: "You have no upcoming bookings right now. Send MENU for options." };
    }
    const enriched = enrichStaff(bookings, await staffByName(bookings));
    const { matched, hasDateHint } = filterBookingsByHints(enriched, text, timezone);
    await setSession({ state: "view_bookings", managementAction: "view_bookings" });
    if (!matched.length) {
      return { action: "view_bookings", reply: `You have nothing booked ${hasDateHint ? `for ${hintLabel(text, timezone)}` : "in the coming days"}.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
    }
    const lines = matched.map((booking) => bookingLine(booking, timezone));
    return { action: "view_bookings", reply: `You have ${matched.length} ${matched.length > 1 ? "bookings" : "booking"} ${hasDateHint ? `for ${hintLabel(text, timezone)}` : "coming up"}:\n${formatOptions(lines)}` };
  };

  const menuReply = async (): Promise<Record<string, unknown>> => {
    await setSession({ state: "menu", managementAction: null, targetAppointmentId: null, modifyField: null });
    return mainMenuPayload();
  };

  const startReschedule = async (appointment: any): Promise<Record<string, unknown>> => {
    const settings = await loadWhatsAppPolicySettings(salonId);
    if (settings.enforceRescheduleCutoff && hoursUntil(appointment.startAt) < settings.rescheduleCutoffHours) {
      return { action: "reschedule_blocked", reply: `This appointment is within the ${settings.rescheduleCutoffHours}-hour reschedule cutoff. Please call the salon to move it manually.` };
    }
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
    const policy = hoursUntil(appointment.startAt) <= settings.rescheduleCutoffHours ? `\nNote: this is within ${settings.rescheduleCutoffHours} hours of your appointment, so salon reschedule rules may apply.` : "";
    return { action: "reschedule_started", reply: `${(appointment.serviceNames || []).join(", ")} is booked for ${mgmtTimeLine(appointment.startAt, timezone)}.${policy}\nWhat date would you like instead? (e.g. tomorrow, Friday, or YYYY-MM-DD)` };
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

  /** Resolves a staff mentioned in a full-sentence move/modify ("with Ananya",
   *  "change staff to Dev") to a different eligible staff id for the target booking. */
  const staffHintFromClause = async (target: any, clauseText: string | null): Promise<string | null> => {
    if (!target) return null;
    const services = await selectedServices({ salonId, branchId: target.branchId, serviceIds: target.serviceIds || [] });
    const staff = services.length ? await eligibleStaffForServices(salonId, target.branchId, services) : [];
    if (!staff.length) return null;
    const hints: string[] = [];
    const collect = (source: string): void => {
      if (!source) return;
      const withHit = source.match(/\b(?:with|under)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (withHit) hints.push(withHit[1]!);
      const swapHit = source.match(/\b(?:switch|change)\s+staff\s+(?:to|for)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (swapHit) hints.push(swapHit[1]!);
      const swapToHit = source.match(/\b(?:switch|change|move)\s+staff\s+to\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (swapToHit) hints.push(swapToHit[1]!);
    };
    collect(clauseText || "");
    collect(text);
    let currentName = "";
    if (target.staffId) currentName = String(await staffNameOf(salonId, target.staffId));
    for (const raw of hints) {
      const name = raw.trim().replace(/\.$/, "").replace(/\s+at\s+.*$/i, "").replace(/\s+(on|this)\s+.*$/i, "");
      const match = fuzzyClosestName(staff.map((item) => item.name), name);
      if (match && !match.ambiguous) {
        if (currentName && match.name.toLowerCase() === currentName.toLowerCase()) continue;
        const picked = staff.find((item) => item.name === match.name);
        if (picked) return picked.staffId;
      }
    }
    return null;
  };

  /** Applies a full-sentence move/modify to a target booking: new date (optional) and/or
   *  new staff (optional). Resolves the concrete slot, then stages a confirm_modify draft. */
  const smartModifyInto = async (appointment: any, date: string | null, newStaffId: string | null): Promise<Record<string, unknown>> => {
    const services = await selectedServices({ salonId, branchId: appointment.branchId, serviceIds: appointment.serviceIds || [] });
    const summary = summarizeServices(services);
    const duration = summary.duration || appointment.durationMinutes || 0;
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(appointment.startAt));
    const targetStaffId = newStaffId || appointment.staffId;
    const base = {
      managementAction: "modify",
      modifyField: date ? "date_time" : "staff",
      targetAppointmentId: String(appointment._id),
      branchId: appointment.branchId,
      staffId: targetStaffId,
      serviceIds: appointment.serviceIds || [],
      serviceNames: appointment.serviceNames || [],
      durationMinutes: duration,
      value: summary.value || appointment.value || 0,
      category: null,
      categoryPage: 0,
      servicePage: 0,
      staffPage: 0,
      date: localDate,
      startAt: new Date(appointment.startAt),
      availableSlots: []
    };
    if (date) {
      const slots = await suggestedSlots(salonId, appointment.branchId, targetStaffId, date, duration, String(appointment._id), 96);
      if (!slots.length) {
        const next = await nextAvailableDates(salonId, appointment.branchId, targetStaffId, duration, date, String(appointment._id));
        const hint = next.length ? ` Free on: ${next.slice(0, 3).map(displayDate).join(", ")}.` : "";
        await setSession({ ...base, date, state: "modify_choose_field" });
        return { action: "no_slots", reply: `${(appointment.serviceNames || []).join(", ")} can't move to ${displayDate(date)} — no free slots.${hint}\nReply BACK for the change menu, or send another date/time.` };
      }
      const preference = parseTimePreference(text);
      const narrowed = filterSlotsByPreference(slots, preference);
      let picked: { label: string; startAt: Date } | null = narrowed.length === 1 ? narrowed[0] : null;
      if (!picked) picked = pickBestSlot(slots, text).candidate || narrowed[0] || null;
      if (picked) {
        await setSession({ ...base, date, startAt: new Date(picked.startAt), availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })), state: "confirm_modify" });
        return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
      }
      await setSession({ ...base, date, startAt: null, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })), state: "select_time" });
      const staffName = await staffNameOf(salonId, targetStaffId);
      return {
        action: "modify_slots",
        reply: `Available slots on ${displayDate(date)}${newStaffId ? ` with ${staffName}` : ""}:\n${formatOptions(slots.map((slot) => slot.label))}`,
        interactive: listInteractive("Choose time slot:", "Time Slots", slots.slice(0, 10).map((slot) => ({ id: slot.label, title: slot.label })))
      };
    }
    await setSession({ ...base, state: "confirm_modify" });
    return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
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

  const addToWaitlist = async (): Promise<Record<string, unknown>> => {
    const lastAppointment = await AppointmentModel.findOne({ salonId, customerId: String(customer._id), status: { $in: ["completed", "cancelled", "expired", "no_show"] } }).sort({ startAt: -1 }).lean();
    if (!lastAppointment || !lastAppointment.serviceIds?.length) {
      return { action: "waitlist_need_booking", reply: "I can add you to the waitlist once you've booked a service. Send 'Book appointment' to get started." };
    }
    const existing = await WaitlistModel.findOne({ salonId, customerId: String(customer._id), status: "waiting", serviceIds: lastAppointment.serviceIds });
    if (existing) {
      return { action: "waitlist_exists", reply: `You're already on the waitlist for ${(lastAppointment.serviceNames || []).join(", ")}. I'll message you the moment a spot opens.` };
    }
    await WaitlistModel.create({
      salonId,
      branchId: lastAppointment.branchId,
      staffId: lastAppointment.staffId,
      serviceIds: lastAppointment.serviceIds.map(String),
      serviceNames: lastAppointment.serviceNames || [],
      date: "",
      preferredTime: "",
      customerId: String(customer._id),
      customerPhone: phone,
      status: "waiting",
      notified: false
    });
    await setSession({ state: "menu" });
    return { action: "waitlist_added", reply: `You're on the waitlist for ${(lastAppointment.serviceNames || []).join(", ")}. I'll notify you here the moment a slot opens — just reply BOOK to claim it within 15 minutes.` };
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

  const faqReply = async (): Promise<Record<string, unknown> | null> => {
    const [cfg, salon, settingsDoc] = await Promise.all([
      ctx.branchId ? BranchModel.findOne({ _id: ctx.branchId, salonId }).lean() : Promise.resolve(null),
      SalonModel.findOne({ _id: salonId }).lean(),
      OwnerSettingsModel.findOne({ salonId, branchId: "" }).lean()
    ]);
    const botSettings = (settingsDoc?.settings as { whatsappBot?: { personality?: "friendly" | "luxury" | "quick" | "hinglish"; address?: string; contact?: string; instagram?: string; paymentModes?: string[]; parking?: string; customAnswers?: Array<{ question: string; answer: string; keywords?: string[]; enabled?: boolean }> } } | undefined)?.whatsappBot || {};
    const branchDocs = await BranchModel.find({ salonId, status: "active" }).lean();
    const services = await ServiceModel.find(branchServiceFilter(salonId, cfg?._id || ctx.branchId)).select("name pricePaise durationMinutes").sort({ pricePaise: 1 }).limit(60).lean();
    const staff = await UserModel.find({ salonId, status: "active", ...(cfg?._id ? { branchIds: cfg._id } : {}) }).select("name").sort({ name: 1 }).limit(12).lean();
    const faqCtx: FaqContext = {
      salonName: salon?.name || undefined,
      personality: botSettings.personality || undefined,
      address: botSettings.address || undefined,
      contact: botSettings.contact || undefined,
      branches: branchDocs.map((branch) => ({
        name: branch.name,
        timezone: branch.timezone,
        hours: (branch.hours || []).map((h) => ({ weekday: h.weekday, open: h.open, close: h.close, closed: !!h.closed }))
      })),
      services: services.map((service) => ({ name: service.name, pricePaise: service.pricePaise, durationMinutes: service.durationMinutes })),
      staff: staff.map((person) => ({ name: person.name })),
      customAnswers: botSettings.customAnswers || []
    };
    const faq = answerFaq(text, faqCtx);
    if (!faq) return null;
    if (faq.matched === "price") await tagCustomerLead(salonId, phone, ["price_shopper"]);
    return { action: faq.action, reply: `${faq.answer}\n\nSend MENU for other options, or BOOK to make an appointment.` };
  };

  const policyReply = async (): Promise<Record<string, unknown> | null> => {
    if (!/\b(policy|policies|cancel(?:lation)?|refund|deposit|advance|late|reschedule|cutoff|no show|no-show)\b/.test(lower)) return null;
    const settings = await loadWhatsAppPolicySettings(salonId);
    if (/\b(cancel|cancellation)\b/.test(lower)) {
      return { action: "faq_cancellation_policy", reply: `Cancellation policy: ${settings.enforceCancellationCutoff ? `online cancellation is blocked within ${settings.cancellationCutoffHours} hours of the appointment.` : `late-cancellation rules may apply within ${settings.cancellationCutoffHours} hours.`}\nDeposit/refund: ${settings.depositRefundPolicy}\n\nSend MENU for options.` };
    }
    if (/\b(reschedule|move|shift)\b/.test(lower)) {
      return { action: "faq_reschedule_policy", reply: `Reschedule policy: ${settings.enforceRescheduleCutoff ? `online reschedule is blocked within ${settings.rescheduleCutoffHours} hours of the appointment.` : `reschedule rules may apply within ${settings.rescheduleCutoffHours} hours.`}\n\nSend RESCHEDULE to move an upcoming booking.` };
    }
    if (/\b(deposit|advance|refund)\b/.test(lower)) {
      return { action: "faq_deposit_policy", reply: `Deposit/refund policy: ${settings.depositRefundPolicy}\n\nIf an advance is needed, I'll send the payment link during booking.` };
    }
    return { action: "faq_policy", reply: `Salon policy summary:\nCancellation cutoff: ${settings.cancellationCutoffHours} hours${settings.enforceCancellationCutoff ? " (enforced online)" : ""}\nReschedule cutoff: ${settings.rescheduleCutoffHours} hours${settings.enforceRescheduleCutoff ? " (enforced online)" : ""}\nDeposit/refund: ${settings.depositRefundPolicy}` };
  };

  const serviceContextFromMessage = async (): Promise<Record<string, unknown> | null> => {
    if (!/\b(price|prices|rate|rates|cost|charge|kitna|kitne|kitni|fees|duration|how long|kitni der|kitna time|minutes?|mins?|takes?)\b/.test(lower)) return null;
    const targetBranchId = branches.length === 1 ? branches[0]!._id : ctx.branchId;
    const resolved = await resolveServiceIntents({ text, salonId, branchId: targetBranchId });
    if (resolved.matched.length !== 1 || resolved.ambiguousNames.length) return null;
    const picked = resolved.matched[0]!.service;
    await setSession({
      state: "select_date",
      managementAction: null,
      targetAppointmentId: null,
      modifyField: null,
      branchId: targetBranchId,
      category: picked.category || null,
      serviceId: String(picked._id),
      serviceName: picked.name,
      serviceIds: [String(picked._id)],
      serviceNames: [picked.name],
      durationMinutes: picked.durationMinutes,
      value: picked.pricePaise,
      availableSlots: [],
      date: null,
      startAt: null,
      staffId: null
    });
    await tagCustomerLead(salonId, phone, ["price_shopper", "hot_lead"]);
    return {
      action: "service_context_ready",
      reply: `${picked.name} is ${money(picked.pricePaise)} and takes ${picked.durationMinutes} minutes. Want to book it? Send a day/time like "tomorrow evening" or "Friday 5pm".`,
      interactive: buttonsInteractive("Book this service?", [{ id: "yes", title: "Yes" }, { id: "menu", title: "Menu" }])
    };
  };

  const staffAvailabilityReply = async (): Promise<Record<string, unknown> | null> => {
    if (!/\b(available|availability|free|slot|slots|khali|milega|mil sakta|hai kya)\b/.test(lower)) return null;
    const date = parseNaturalDate(text, timezone);
    if (!date) return null;
    const targetBranchId = branches.length === 1 ? branches[0]!._id : ctx.branchId;
    const users = await UserModel.find({ salonId, branchIds: targetBranchId, status: "active", staffId: { $ne: null } }).select("name staffId").sort({ name: 1 }).lean();
    const staff = users.filter((user) => user.staffId).map((user) => ({ staffId: user.staffId!, name: user.name }));
    const pickedStaff = resolveStaffIntent(text, staff);
    if (!pickedStaff) return null;
    const serviceHint = await resolveServiceIntents({ text, salonId, branchId: targetBranchId });
    const services = serviceHint.matched.length && !serviceHint.ambiguousNames.length
      ? serviceHint.matched.map((entry) => entry.service)
      : await ServiceModel.find(branchServiceFilter(salonId, targetBranchId)).select("name category pricePaise durationMinutes eligibleStaffIds").sort({ durationMinutes: 1 }).limit(1).lean();
    const summary = summarizeServices(services.map((service) => ({ name: service.name, durationMinutes: service.durationMinutes, pricePaise: service.pricePaise })));
    const slots = await suggestedSlots(salonId, targetBranchId, pickedStaff.staffId, date, summary.duration || 45, undefined, 12);
    const narrowed = filterSlotsByPreference(slots, parseTimePreference(text));
    const shown = (narrowed.length ? narrowed : slots).slice(0, 5);
    if (!shown.length) return { action: "staff_no_slots", reply: `${pickedStaff.name} has no free slots on ${displayDate(date)}. Send another day/time, or BOOK to choose another staff member.` };
    await tagCustomerLead(salonId, phone, ["availability_shopper", "hot_lead"]);
    return {
      action: "staff_availability",
      reply: `${pickedStaff.name} is free on ${displayDate(date)} at:\n${formatOptions(shown.map((slot) => slot.label))}\nReply "book ${services[0]?.name || "service"} ${displayDate(date)} at ${shown[0]!.label} with ${pickedStaff.name}" to lock one.`,
      interactive: buttonsInteractive("Want to book?", [{ id: "book_appointment", title: "Book appointment" }, { id: "menu", title: "Menu" }])
    };
  };

  const packageReply = async (): Promise<Record<string, unknown> | null> => {
    if (!/\b(combo|package|deal|offer|together|and|with|plus|\+)\b/.test(lower)) return null;
    const targetBranchId = branches.length === 1 ? branches[0]!._id : ctx.branchId;
    const resolved = await resolveServiceIntents({ text, salonId, branchId: targetBranchId });
    if (resolved.matched.length < 2 || resolved.ambiguousNames.length) return null;
    const services = resolved.matched.slice(0, 4).map((entry) => entry.service);
    const summary = summarizeServices(services.map((service) => ({ name: service.name, durationMinutes: service.durationMinutes, pricePaise: service.pricePaise })));
    await setSession({
      state: "select_date",
      branchId: targetBranchId,
      managementAction: null,
      serviceId: String(services[0]!._id),
      serviceName: services[0]!.name,
      serviceIds: services.map((service) => String(service._id)),
      serviceNames: services.map((service) => service.name),
      durationMinutes: summary.duration,
      value: summary.value,
      date: null,
      startAt: null,
      staffId: null,
      availableSlots: []
    });
    await tagCustomerLead(salonId, phone, ["combo_interest", "hot_lead"]);
    return { action: "combo_context_ready", reply: `I can book ${summary.names.join(" + ")} together. Total: ${money(summary.value)}, ${summary.duration} minutes. Send a day/time like "tomorrow evening" to check slots.`, interactive: buttonsInteractive("Book combo?", [{ id: "yes", title: "Yes" }, { id: "menu", title: "Menu" }]) };
  };

  try {
    const effectiveCommand = command || (session?.state === "menu" ? managementIntent(lower, { intent: "" }) : null);
    if (effectiveCommand) {
      switch (effectiveCommand) {
        case "menu":
          return await menuReply();
        case "view_bookings":
          if (!!parseNaturalDate(text, timezone) || /\b(this week|upcoming week|next week|this weekend|weekend|today|tomorrow|kal|parso|when|what time|anything|something)\b/.test(lower)) {
            return await naturalBookingsReply();
          }
          return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        case "view_history":
          return await relistHistory();
        case "cancel":
          {
            const target = await cancelTargetFromMessage();
            if (target) return await confirmCancelFor(target);
          }
          return await relistUpcoming("Which appointment should I cancel? Reply with a number.", "select_cancel_booking");
        case "reschedule":
          {
            const canAutoTarget = !!extractBookingId(text) || !["reschedule_booking", "reschedule", "reschedule booking"].includes(lower);
            const target = canAutoTarget ? await activeTargetFromMessage() : null;
            if (target) {
              const clause = extractToClause(text);
              const requestedDate = (clause && parseNaturalDate(clause, timezone)) || parseNaturalDate(text, timezone);
              const newStaffId = await staffHintFromClause(target, clause);
              const prefHint = parseTimePreference(clause || text);
              const autoResolve = prefHint.flexible === true || (prefHint.after != null && prefHint.before != null);
              if (newStaffId) return await smartModifyInto(target, requestedDate, newStaffId);
              if (requestedDate && autoResolve) return await smartModifyInto(target, requestedDate, newStaffId);
              if (requestedDate) return await rescheduleDateReply(target, requestedDate, clause);
              return await startReschedule(target);
            }
          }
          return await relistUpcoming("Which appointment would you like to reschedule? Reply with a number.", "select_reschedule_booking");
        case "modify":
          {
            const canAutoTarget = !!extractBookingId(text) || !["modify_booking", "modify", "modify booking"].includes(lower);
            const target = canAutoTarget ? await activeTargetFromMessage() : null;
            if (target) {
              const clause = extractToClause(text);
              const requestedDate = (clause && parseNaturalDate(clause, timezone)) || parseNaturalDate(text, timezone);
              const newStaffId = await staffHintFromClause(target, clause);
              if (newStaffId || requestedDate) return await smartModifyInto(target, requestedDate, newStaffId);
              return await startModify(target);
            }
          }
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

    if (lower === "menu") {
      return await menuReply();
    }

    switch (session.state) {
      case "menu": {
        const menuAction = menuActionFor(text);
        if (menuAction === "book_appointment" || BOOKING_KEYWORDS.includes(lower)) return await startBookingFromMenu();
        if (menuAction === "view_bookings") return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        if (menuAction === "view_history") return await relistHistory();
        if (menuAction === "reschedule_booking") return await relistUpcoming("Which appointment would you like to reschedule? Reply with a number.", "select_reschedule_booking");
        if (menuAction === "modify_booking") return await relistUpcoming("Which booking would you like to modify? Reply with a number.", "select_modify_booking");
        if (menuAction === "cancel_booking") return await relistUpcoming("Which appointment should I cancel? Reply with a number.", "select_cancel_booking");
        if (menuAction === "rebook_service") return await relistHistory();
        if (menuAction === "menu") return await menuReply();
        if (/waitlist|wait list|waiting list|notify me/.test(lower)) return await addToWaitlist();
        const policy = await policyReply();
        if (policy) return policy;
        const pkg = await packageReply();
        if (pkg) return pkg;
        const staffAvailability = await staffAvailabilityReply();
        if (staffAvailability) return staffAvailability;
        const serviceContext = await serviceContextFromMessage();
        if (serviceContext) return serviceContext;
        const faq = await faqReply();
        if (faq) return faq;
        const menu = mainMenuPayload();
        return { ...menu, action: "menu_recovery", reply: `I didn't catch that. You can type things like:\n- book haircut tomorrow 5pm\n- haircut price\n- timings\n- my bookings\n\n${menu.reply}` };
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
        const manageAction = manageActionFor(text);
        if (manageAction === "reschedule") return await startReschedule(target);
        if (manageAction === "modify") return await startModify(target);
        if (manageAction === "cancel") return await confirmCancelFor(target);
        if (manageAction === "rebook") return await startRebook(target);
        if (manageAction === "back" || lower === "back") return await relistUpcoming("Your upcoming bookings — reply with a number to manage that booking:", "view_bookings");
        return {
          action: "needs_manage_action",
          reply: "What would you like to do with this booking?\n1. Reschedule\n2. Modify booking\n3. Cancel booking\n4. Rebook service\n5. Back to all bookings",
          interactive: listInteractive("Manage booking:", "Manage", [
            { id: "reschedule", title: "Reschedule" },
            { id: "modify", title: "Modify booking" },
            { id: "cancel", title: "Cancel booking" },
            { id: "rebook", title: "Rebook service" },
            { id: "back", title: "Back to all bookings" }
          ])
        };
      }

      case "select_cancel_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        return await confirmCancelFor(picked);
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
        return {
          action: "needs_cancel_confirm",
          reply: "Reply CONFIRM to cancel this booking, or CANCEL to back out.",
          interactive: buttonsInteractive("Cancel this booking?", [
            { id: "confirm", title: "Yes, cancel" },
            { id: "back", title: "Keep booking" }
          ])
        };
      }

      case "select_reschedule_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        return await startReschedule(picked);
      }

      case "reschedule_date": {
        const dateInput = parseNaturalDate(text, timezone);
        if (!dateInput) return { action: "needs_date", reply: "Please send the new date like tomorrow, Friday, or YYYY-MM-DD." };
        if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
        if (!session.staffId || !session.durationMinutes) return { action: "invalid_session", reply: "Booking details are missing. Send MENU to start over." };
        const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, session.durationMinutes, session.targetAppointmentId);
        if (!slots.length) {
          const next = await nextAvailableDates(salonId, session.branchId, session.staffId, session.durationMinutes, dateInput, session.targetAppointmentId);
          const hint = next.length ? ` Free on: ${next.map(displayDate).join(", ")}.` : "";
          return { action: "no_slots", reply: `No slots are available for the selected staff on ${displayDate(dateInput)}.${hint} Please send another date.` };
        }
        await setSession({ state: "reschedule_time", date: dateInput, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })) });
        return { action: "reschedule_slots", reply: `Available slots on ${displayDate(dateInput)}:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose new time:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
      }

      case "reschedule_time": {
        const slots = session.availableSlots || [];
        const picked = pickBestSlot(slots, text);
        const selected = picked.candidate || null;
        if (!selected) {
          const candidates = picked.candidates || [];
          if (candidates.length) return { action: "needs_time", reply: `I found a few options around that time:\n${formatOptions(candidates.map((slot) => slot.label))}\nReply with one.` };
          return { action: "needs_time", reply: `Please choose a valid slot.\n${formatOptions((slots as Array<{ label: string }>).map((slot) => slot.label))}` };
        }
        const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
        const zone = branch?.timezone || timezone;
        const [hour, minute] = String(selected.label).split(":").map(Number);
        const startAt = new Date(selected.startAt as Date) || zonedTimeToUtc(zone, session.date || "", hour || 0, minute || 0);
        const endAt = new Date(startAt.getTime() + session.durationMinutes * 60_000);
        if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone: zone, excludeAppointmentId: session.targetAppointmentId }))) {
          const nearby = await freeNearbySlots(salonId, session.branchId, session.staffId, session.date || "", session.durationMinutes, String(selected.label), session.targetAppointmentId);
          if (nearby.length) return { action: "slot_unavailable", reply: `That slot is booked. Free nearby:\n${formatOptions(nearby.map((slot) => slot.label))}\nReply with one.` };
          return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose reschedule again." };
        }
        const updated = await rescheduleAppointmentForCustomer({ salonId, appointmentId: session.targetAppointmentId, branchId: session.branchId, staffId: session.staffId, serviceIds: session.serviceIds || [], serviceNames: session.serviceNames || [], durationMinutes: session.durationMinutes, value: session.value, startAt, endAt });
        await finishManagementSession(session);
        const branchTitle = branchName(session.branchId);
        const staffTitle = await staffNameOf(salonId, session.staffId);
        return {
          action: "appointment_rescheduled",
          appointmentId: updated.id,
          reply: withSuccessTip(`Your appointment has been rescheduled successfully.\n${bookingSummaryLines({ bookingId: updated.id, serviceNames: session.serviceNames || [], staffName: staffTitle, branchName: branchTitle, startAt, timezone: zone, durationMinutes: session.durationMinutes, value: session.value })}`)
        };
      }

      case "select_modify_booking": {
        const bookings = await upcomingBookings(salonId, customerId, 10);
        const picked = pickBooking(text, bookings);
        if (!picked) return { action: "needs_booking", reply: `Please reply with a valid booking number.\n${formatOptions(bookings.map((booking) => bookingLine(booking, timezone)))}` };
        return await startModify(picked);
      }

      case "modify_choose_field": {
        const changeStaffTo = text.match(/change\s+staff\s+(?:to|for|:\s*)\s*(.+)/i);
        if (changeStaffTo && (session.serviceIds || []).length) {
          const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
          const staff = await eligibleStaffForServices(salonId, session.branchId, services);
          const target = changeStaffTo[1]!.trim();
          const match = fuzzyClosestName(staff.map((item) => item.name), target);
          const currentStaffTitle = String(session.staffId ? (await staffNameOf(salonId, session.staffId)) : "");
          if (match && !match.ambiguous && match.name.toLowerCase() !== currentStaffTitle.toLowerCase()) {
            const picked = staff.find((item) => item.name === match.name);
            if (picked) {
              await setSession({ modifyField: "staff", staffId: picked.staffId, state: "confirm_modify" });
              return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
            }
          }
        }
        const removeByName = /^\s*(?:remove|delete|drop|take\s+off)\s+(.+)$/i.exec(text);
        if (removeByName && (session.serviceNames || []).length) {
          const targetName = removeByName[1]!.trim();
          const isSelected = (session.serviceNames as string[]).some((name) => normalizedNameKey(name).includes(normalizedNameKey(targetName)) || normalizedNameKey(targetName).includes(normalizedNameKey(name)));
          if (isSelected) {
            const removed = await removeDraftServices(session, { mode: "name", name: targetName }, setSession, salonId);
            if (removed.action === "services_removed") {
              if (!(session.serviceIds || []).length) {
                return {
                  action: "services_removed",
                  reply: "All services were removed from this booking. Add a service or change another field:\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes",
                  interactive: listInteractive("What would you like to change?", "Modify", [
                    { id: "modify_service", title: "Change services" },
                    { id: "modify_staff", title: "Change staff" },
                    { id: "modify_branch", title: "Change branch" },
                    { id: "modify_datetime", title: "Change date/time" }
                  ])
                };
              }
              return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
            }
            return removed;
          }
        }
        const addByName = /^\s*add\s+(.+)$/i.exec(text);
        if (addByName) {
          const services = await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("name pricePaise durationMinutes");
          const match = fuzzyClosestName(services.map((item) => item.name), addByName[1]!.trim());
          if (match && !match.ambiguous) {
            const pickedService = services.find((item) => item.name === match.name);
            if (pickedService) {
              const nextIds = [...((session.serviceIds as string[]) || []), String(pickedService._id)];
              const nextNames = [...((session.serviceNames as string[]) || []), pickedService.name];
              const docs = await selectedServices({ salonId, branchId: session.branchId, serviceIds: nextIds });
              const summary = summarizeServices(docs);
              await setSession({ modifyField: "service", serviceIds: nextIds, serviceNames: nextNames, durationMinutes: summary.duration, value: summary.value, state: "confirm_modify" });
              return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
            }
          }
        }
        const field = modifyFieldOption(text);
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
        if (field === 4 || lower === "time" || lower === "date" || lower.includes("change time") || lower.includes("change date") || /\b(make it|shift|move)\b/.test(lower)) {
          if (!session.staffId || !session.serviceIds?.length) return { action: "needs_more_changes", reply: "Please choose services and staff first, then change the date/time." };
          await setSession({ modifyField: "date_time", state: "select_date" });
          return { action: "modify_date", reply: `Currently ${mgmtTimeLine(session.startAt, timezone)}. What date would you like instead? (e.g. tomorrow, Friday, or YYYY-MM-DD)` };
        }
        if (field === 5 || lower === "done" || lower === "apply" || lower.startsWith("confirm")) {
          return await confirmModifyReply(salonId, session, setSession, branchName, timezone);
        }
        return {
          action: "needs_modify_field",
          reply: "What would you like to change?\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes",
          interactive: listInteractive("What would you like to change?", "Modify", [
            { id: "modify_service", title: "Change services" },
            { id: "modify_staff", title: "Change staff" },
            { id: "modify_branch", title: "Change branch" },
            { id: "modify_datetime", title: "Change date/time" },
            { id: "modify_apply", title: "Done — apply changes" }
          ])
        };
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
        if (lower === "back") {
          if ((session.servicePage || 0) > 0) {
            const prevPageNumber = (session.servicePage || 0) - 1;
            await setSession({ servicePage: prevPageNumber });
            const prevPage = pagedOptions(services, prevPageNumber);
            return { action: "service_page", reply: pageReply("Previous services:", prevPage.pageItems.map((item) => `${item.name} - ${money(item.pricePaise)}`), prevPage.hasNext), interactive: listInteractive("Choose a service:", "Services", [...prevPage.pageItems.map((item) => ({ id: String(item._id), title: item.name.slice(0, 24), description: money(item.pricePaise) })), ...(prevPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
          }
          await setSession({ state: "select_category" });
          const categories = [...new Set((await ServiceModel.find(branchServiceFilter(salonId, session.branchId)).select("category name")).map((item) => item.category || "Services"))];
          const categoryPage = pagedOptions(categories, session.categoryPage || 0);
          return { action: "modify_service_category", reply: `${pageReply("Choose a service category:", categoryPage.pageItems, categoryPage.hasNext)}\n\nOr type any service name to search.`, interactive: listInteractive("Categories:", "Categories", [...categoryPage.pageItems.map((category) => ({ id: category, title: category })), ...(categoryPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
        if (isMoreInput(text) || (Number(text) === WHATSAPP_PAGE_SIZE + 1 && (session.servicePage || 0) * WHATSAPP_PAGE_SIZE + WHATSAPP_PAGE_SIZE < services.length)) {
          const nextPageNumber = (session.servicePage || 0) + 1;
          await setSession({ servicePage: nextPageNumber });
          const nextPage = pagedOptions(services, nextPageNumber);
          return { action: "service_page", reply: pageReply("More services:", nextPage.pageItems.map((item) => `${item.name} - ${money(item.pricePaise)}`), nextPage.hasNext), interactive: listInteractive("More services:", "Services", [...nextPage.pageItems.map((item) => ({ id: String(item._id), title: item.name.slice(0, 24), description: money(item.pricePaise) })), ...(nextPage.hasNext ? [{ id: "more", title: "More" }] : [])]) };
        }
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
        const removeIntent = removeServiceIntent(text);
        if (removeIntent) return await removeDraftServices(session, removeIntent, setSession, salonId);
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
          : { action: "rebook_date", reply: `${(selectedUser?.name || selected.staffId) || "Staff"} selected. What date would you like? (e.g. tomorrow, Friday, or YYYY-MM-DD)` };
      }

      case "select_date": {
        if (!["modify", "rebook"].includes(session.managementAction)) return { action: "ignored", reply: "Send MENU for options." };
        if (lower === "back" || lower === "cancel") {
          if (session.managementAction === "modify") {
            await setSession({ state: "modify_choose_field" });
            return {
              action: "modify_choose_field",
              reply: "What would you like to change?\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes",
              interactive: listInteractive("What would you like to change?", "Modify", [
                { id: "modify_service", title: "Change services" },
                { id: "modify_staff", title: "Change staff" },
                { id: "modify_branch", title: "Change branch" },
                { id: "modify_datetime", title: "Change date/time" },
                { id: "modify_apply", title: "Done — apply changes" }
              ])
            };
          }
          return await menuReply();
        }
        const dateInput = parseNaturalDate(text, timezone);
        if (!dateInput) return { action: "needs_date", reply: "Please send the date like tomorrow, Friday, or YYYY-MM-DD." };
        if (isPastBusinessDate(dateInput)) return { action: "past_date", reply: "Please choose today or a future date." };
        const services = await selectedServices({ salonId, branchId: session.branchId, serviceIds: session.serviceIds || [] });
        const summary = summarizeServices(services);
        const excludeAppointmentId = session.managementAction === "modify" ? session.targetAppointmentId : undefined;
        const slots = await suggestedSlots(salonId, session.branchId, session.staffId, dateInput, summary.duration, excludeAppointmentId);
        if (!slots.length) {
          const next = await nextAvailableDates(salonId, session.branchId, session.staffId, summary.duration, dateInput, session.managementAction === "modify" ? session.targetAppointmentId : undefined);
          const hint = next.length ? ` Free on: ${next.map(displayDate).join(", ")}.` : "";
          return { action: "no_slots", reply: `No slots are available for the selected staff on ${displayDate(dateInput)}.${hint} Reply BACK for the modify menu, CANCEL for main menu, or send another date.` };
        }
        await setSession({ state: "select_time", date: dateInput, availableSlots: slots.map((slot) => ({ label: slot.label, startAt: slot.startAt })), durationMinutes: summary.duration, value: summary.value });
        return { action: "modify_slots", reply: `Available slots on ${displayDate(dateInput)}:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose time slot:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
      }

      case "select_time": {
        if (!["modify", "rebook"].includes(session.managementAction)) return { action: "ignored", reply: "Send MENU for options." };
        if (lower === "back" || lower === "cancel") {
          if (session.managementAction === "modify") {
            await setSession({ state: "modify_choose_field" });
            return {
              action: "modify_choose_field",
              reply: "What would you like to change?\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes",
              interactive: listInteractive("What would you like to change?", "Modify", [
                { id: "modify_service", title: "Change services" },
                { id: "modify_staff", title: "Change staff" },
                { id: "modify_branch", title: "Change branch" },
                { id: "modify_datetime", title: "Change date/time" },
                { id: "modify_apply", title: "Done — apply changes" }
              ])
            };
          }
          return await menuReply();
        }
        const slots = session.availableSlots || [];
        const picked = pickBestSlot(slots, text);
        const selected = picked.candidate || null;
        if (!selected) {
          const candidates = picked.candidates || [];
          if (candidates.length) return { action: "needs_time", reply: `I found a few options around that time:\n${formatOptions(candidates.map((slot) => slot.label))}\nReply with one.` };
          return { action: "needs_time", reply: `Please choose a valid slot.\n${formatOptions((slots as Array<{ label: string }>).map((slot) => slot.label))}` };
        }
        const branch = await BranchModel.findOne({ _id: session.branchId, salonId });
        const zone = branch?.timezone || timezone;
        const startAt = new Date(selected.startAt as Date);
        const endAt = new Date(startAt.getTime() + session.durationMinutes * 60_000);
        const excludeAppointmentId = session.managementAction === "modify" ? session.targetAppointmentId : undefined;
        if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt, endAt, date: session.date || "", timezone: zone, excludeAppointmentId }))) {
          const nearby = await freeNearbySlots(salonId, session.branchId, session.staffId, session.date || "", session.durationMinutes, String(selected.label), excludeAppointmentId);
          if (nearby.length) return { action: "slot_unavailable", reply: `That slot is booked. Free nearby:\n${formatOptions(nearby.map((slot) => slot.label))}\nReply with one.` };
          return { action: "slot_unavailable", reply: "That slot is no longer available. Please send another date to see fresh slots." };
        }
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
        if (lower === "back" || lower === "change" || lower === "cancel") {
          await setSession({ state: "modify_choose_field" });
          return {
            action: "modify_choose_field",
            reply: "What would you like to change?\n1. Change services\n2. Change staff\n3. Change branch\n4. Change date/time\n5. Done — apply changes",
            interactive: listInteractive("What would you like to change?", "Modify", [
              { id: "modify_service", title: "Change services" },
              { id: "modify_staff", title: "Change staff" },
              { id: "modify_branch", title: "Change branch" },
              { id: "modify_datetime", title: "Change date/time" },
              { id: "modify_apply", title: "Done — apply changes" }
            ])
          };
        }
        if (!lower.startsWith("confirm") && lower !== "yes") {
          const summary = await confirmModifyReply(salonId, session, setSession, branchName, timezone);
          return summary.interactive ? summary : { ...summary, interactive: buttonsInteractive("Apply these changes?", [{ id: "confirm", title: "Confirm" }, { id: "back", title: "Change" }]) };
        }
        return await applyModify(salonId, session, branchName, timezone);
      }

      case "confirm_rebook": {
        if (lower === "back" || lower === "change" || lower === "cancel") {
          await setSession({ state: "select_time" });
          const slots = (session.availableSlots || []) as Array<{ label: string }>;
          return { action: "modify_slots", reply: `Choose a different slot:\n${formatOptions(slots.map((slot) => slot.label))}`, interactive: listInteractive("Choose time slot:", "Time Slots", slots.map((slot) => ({ id: slot.label, title: slot.label }))) };
        }
        if (!lower.startsWith("confirm") && lower !== "yes") return { action: "needs_confirm", reply: "Reply CONFIRM to create this appointment, or change to pick another slot.", interactive: buttonsInteractive("Create this appointment?", [{ id: "confirm", title: "Confirm" }, { id: "back", title: "Change slot" }]) };
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
        if (lower === "back" || ["menu", "main menu", "options", "help"].includes(lower)) return await menuReply();
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

async function branchNameOf(salonId: string, branchId: string): Promise<string> {
  const branch = await BranchModel.findOne({ _id: branchId, salonId }).lean();
  return branch?.name || branchId;
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
  if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone: zone, excludeAppointmentId: session.targetAppointmentId }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose modify again." };
  const staffName = await staffNameOf(salonId, session.staffId);
  const branchTitle = branchName(session.branchId);
  return {
    action: "confirm_modify",
    reply: `Apply these changes?\n${bookingSummaryLines({ bookingId: session.targetAppointmentId || "", serviceNames: summary.names, staffName, branchName: branchTitle, startAt: session.startAt, timezone: zone, durationMinutes: summary.duration, value: summary.value })}`,
    interactive: buttonsInteractive("Apply these changes?", [
      { id: "confirm", title: "Confirm" },
      { id: "back", title: "Change" }
    ])
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
  if (!(await isStaffAvailableForBlock({ salonId, branchId: session.branchId, staffId: session.staffId, startAt: session.startAt, endAt, date: session.date || "", timezone: zone, excludeAppointmentId: session.targetAppointmentId }))) return { action: "slot_unavailable", reply: "That slot is no longer available. Send MENU and choose modify again." };
  const updated = await updateAppointmentForCustomer({
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
  return {
    action: "appointment_updated",
    appointmentId: updated.id,
    reply: withSuccessTip(`Your appointment has been updated.\n${bookingSummaryLines({ bookingId: updated.id, serviceNames: summary.names, staffName, branchName: branchName(session.branchId), startAt: session.startAt, timezone: zone, durationMinutes: summary.duration, value: summary.value })}`)
  };
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
  try {
    await AppointmentSlotLockModel.create(slotInstants(session.startAt, endAt).map((slotAt) => ({ salonId, branchId: session.branchId, staffId: session.staffId, appointmentId: String(appointment._id), slotAt })));
  } catch (error) {
    await AppointmentModel.deleteOne({ _id: appointment._id });
    if (isDuplicateKey(error)) return { action: "slot_unavailable", reply: "That slot was just booked by someone else. Send MENU and choose rebook again for fresh slots." };
    throw error;
  }
  publishRealtimeEvent(salonId, "appointment.created", { id: String(appointment._id), branchId: appointment.branchId, staffId: appointment.staffId, startAt: appointment.startAt.toISOString(), endAt: appointment.endAt.toISOString(), status: appointment.status, source: "whatsapp_rebook" });
  await recordCustomerBooking(salonId, session.waPhone, { staffId: appointment.staffId, serviceIds: appointment.serviceIds.map(String), startAt: appointment.startAt });
  void notifyStaffByStaffId(salonId, appointment.staffId, {
    title: "New appointment",
    body: `${appointment.customerName} — ${appointment.serviceNames.join(", ")} at ${appointment.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    tag: `appointment-${String(appointment._id)}`,
    data: { appointmentId: String(appointment._id), type: "appointment.created" }
  });
  const staffName = await staffNameOf(salonId, session.staffId);
  const branchTitle = branch?.name || (await branchNameOf(salonId, session.branchId));

  const deposit = await applyDepositToAppointment({
    salonId,
    branchId: session.branchId,
    appointmentId: String(appointment._id),
    valuePaise: appointment.value,
    customerName: customer.name,
    customerPhone: session.waPhone
  });
  if (deposit.applied) {
    await setSession({ state: "awaiting_payment" });
    await finishManagementSession(session);
    return {
      action: "awaiting_payment",
      appointment: { id: String(appointment._id) },
      reply: `Your slot is held while we process the advance deposit.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName, branchName: branchTitle, startAt: session.startAt, timezone: zone, durationMinutes: summary.duration, value: summary.value })}\nComplete the payment link I just sent. The slot will be released in 30 minutes if not paid.`
    };
  }

  await setSession({ state: "menu", pendingReminder: true });
  await finishManagementSession(session);
  return {
    action: "appointment_created",
    appointment: { id: String(appointment._id) },
    reply: withSuccessTip(`Your appointment is rebooked.\n${bookingSummaryLines({ bookingId: String(appointment._id), serviceNames: summary.names, staffName, branchName: branchTitle, startAt: session.startAt, timezone: zone, durationMinutes: summary.duration, value: summary.value })}\nChoose reminders:\n1. Day before + 2 hours before\n2. Only 2 hours before\n3. Only day before\n4. No reminders`)
  };
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

    const optOutText = message.text?.trim().toUpperCase() || "";
    if (optOutText === "STOP" || optOutText === "UNSUBSCRIBE" || optOutText === "OPT OUT" || optOutText === "STOP ALL") {
      const normalizedPhone = normalizePhone(message.waPhone);
      await CustomerModel.updateOne({ salonId: String(salonId), normalizedPhone }, { $set: { marketingOptOut: true } }, { upsert: true });
      await sendWhatsAppMessage({
        salonId: String(salonId),
        toPhone: normalizedPhone,
        type: "utility",
        body: "You're unsubscribed from promotional messages. You'll still receive booking confirmations and reminders. Reply START to opt back in."
      });
      await WhatsAppInboundModel.create({ salonId: String(salonId), waPhone: normalizedPhone, profileName: message.profileName, messageId: message.messageId, text: message.text, receivedAt: new Date(message.timestampMs), appointmentId: null });
      await WhatsAppWebhookEventModel.updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } });
      ok(res, { successHandled: true, action: "opted_out" });
      return;
    }
    if (optOutText === "START") {
      const normalizedPhone = normalizePhone(message.waPhone);
      await CustomerModel.updateOne({ salonId: String(salonId), normalizedPhone }, { $set: { marketingOptOut: false } }, { upsert: true });
      await sendWhatsAppMessage({ salonId: String(salonId), toPhone: normalizedPhone, type: "utility", body: "You're back on our list for booking confirmations, reminders, and offers." });
      await WhatsAppInboundModel.create({ salonId: String(salonId), waPhone: normalizedPhone, profileName: message.profileName, messageId: message.messageId, text: message.text, receivedAt: new Date(message.timestampMs), appointmentId: null });
      await WhatsAppWebhookEventModel.updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } });
      ok(res, { successHandled: true, action: "opted_in" });
      return;
    }

    const normalizedPhone = normalizePhone(message.waPhone);
    let result: Record<string, unknown>;
    if (!["text", "interactive"].includes(message.messageType)) {
      const mediaTag = message.messageType === "audio" ? "voice_note" : message.messageType === "image" || message.messageType === "document" ? "payment_review" : "manual_review";
      await tagCustomerLead(String(salonId), normalizedPhone, [mediaTag, "manual_review"]);
      await NotificationModel.create({ salonId: String(salonId), staffId: null, title: "WhatsApp manual review", body: `${message.profileName || normalizedPhone} sent ${message.messageType}. Open WhatsApp inbox to review it.`, status: "unread" });
      result = { action: "manual_review", reply: message.messageType === "audio" ? "I can't listen to voice notes yet. Please type your service, day and time, or send MENU." : "I've shared this with the salon team for review. For booking, please type your service, day and time, or send MENU." };
    } else {
      result = message.flowResponse ? await handleBookingFlowCompletion(String(salonId), message) : await handleBookingMessage(String(salonId), branchId, message);
    }

    if (message.text && !message.flowResponse) {
      const missActions = new Set(["needs_menu", "needs_manage_action", "needs_category", "needs_service", "needs_staff", "needs_date", "needs_time", "needs_booking", "needs_cancel_confirm", "needs_reschedule_confirm", "needs_more_changes", "needs_modify_field", "needs_slot"]);
      const missHints: Record<string, string> = {
        needs_menu: "send MENU to see your options",
        needs_manage_action: "reply with a number from the action list",
        needs_category: "pick a category or type a service name (e.g. massage)",
        needs_service: "reply with a service number or type its name",
        needs_staff: "reply with a staff number or type their name",
        needs_date: "send a date like tomorrow or Friday",
        needs_time: "send a time like 3pm or 15:30",
        needs_booking: "reply with a booking number from the list",
        needs_cancel_confirm: "reply CONFIRM or CANCEL",
        needs_reschedule_confirm: "reply CONFIRM or CANCEL",
        needs_more_changes: "reply YES, a service name, or DONE",
        needs_modify_field: "reply with a number from the change list (1-5)",
        needs_slot: "reply with a slot time from the list"
      };
      const misses = missActions.has(String(result.action));
      const sessionDoc = await WhatsAppBookingSessionModel.findOne({ salonId, waPhone: normalizePhone(message.waPhone) }).select("consecutiveFailures").lean();
      const current = Number((sessionDoc as { consecutiveFailures?: number } | null)?.consecutiveFailures || 0);
      const next = misses ? current + 1 : 0;
      if (next >= 3) {
        await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: normalizePhone(message.waPhone) }, { $setOnInsert: { branchId, state: "menu", expiresAt: sessionExpiry() }, $set: { consecutiveFailures: 0 } }, { upsert: true });
        if (result.reply) result.reply = `${String(result.reply)}\n\nNot sure where you are? Send HELP for options, or MENU to start over.`;
      } else if (result.reply) {
        await WhatsAppBookingSessionModel.updateOne({ salonId, waPhone: normalizePhone(message.waPhone) }, { $setOnInsert: { branchId, state: "menu", expiresAt: sessionExpiry() }, $set: { consecutiveFailures: next } }, { upsert: true });
        const hint = missHints[String(result.action)];
        if (next === 2 && hint) result.reply = `Hmm, I couldn't understand that message. Could you ${hint}?\n\n${String(result.reply)}`;
      }
    }

    if (result.reply) {
      await sendWhatsAppMessage({
        salonId: String(salonId),
          toPhone: normalizedPhone,
        type: "utility",
        body: String(result.reply),
        interactive: (result.interactive as Record<string, unknown> | undefined) || null,
        metadata: { dedupeKey: `bot_reply:${message.messageId || `${message.waPhone}:${message.timestampMs}`}`, source: "bot_reply", action: String(result.action || "unknown"), hasInteractive: !!result.interactive },
        appointmentId: result.action === "appointment_created" ? String((result.appointment as { id?: string }).id || "") : null
      });
    }
    const followUp = (result.followUp ?? null) as { reply?: unknown; interactive?: unknown; action?: unknown } | null;
    if (result.followUp && followUp?.reply) {
      await sendWhatsAppMessage({
        salonId: String(salonId),
          toPhone: normalizedPhone,
        type: "utility",
        body: String(followUp.reply),
        interactive: (followUp.interactive as Record<string, unknown> | undefined) || null,
        metadata: { dedupeKey: `bot_reply:${message.messageId || `${message.waPhone}:${message.timestampMs}`}:#followup`, source: "bot_reply", action: String(followUp.action || "menu"), hasInteractive: !!followUp.interactive },
        appointmentId: null
      });
    }
    await WhatsAppInboundModel.create({
      salonId: salonId,
      waPhone: normalizedPhone,
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
