import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { logger } from "../shared/logger";
import { AppointmentModel } from "../models/appointment.model";
import { AppointmentSlotLockModel } from "../models/appointment-slot-lock.model";
import { CustomerModel } from "../models/customer.model";
import { BranchModel } from "../models/branch.model";
import { WaitlistModel } from "../models/waitlist.model";
import { WhatsAppBookingSessionModel } from "../models/whatsapp-booking-session.model";
import { OwnerSettingsModel } from "../models/owner-settings.model";
import { WhatsAppOutboundModel } from "../models/whatsapp-outbound.model";
import { WhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage } from "../modules/whatsapp/whatsapp.service";

function money(paise: number): string {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

async function branchTimezone(salonId: string, branchId: string): Promise<string> {
  const branch = await BranchModel.findOne({ _id: branchId, salonId }).lean();
  return branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
}

function fmt(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
}

interface NudgeSettings {
  birthdayOfferPercent: number;
  feedbackDelayMinutes: number;
  rebookingWeeks: number;
  loyaltyStep: number;
  noShowEnabled: boolean;
  abandonedEnabled: boolean;
  birthdayEnabled: boolean;
  feedbackEnabled: boolean;
  rebookingEnabled: boolean;
  loyaltyEnabled: boolean;
}

async function nudgeSettingsFor(salonId: string): Promise<NudgeSettings> {
  const settings = await OwnerSettingsModel.findOne({ salonId, branchId: "" }).lean();
  const nudges = (settings?.settings as { whatsappNudges?: Partial<NudgeSettings> } | undefined)?.whatsappNudges || {};
  return {
    birthdayOfferPercent: Math.max(0, Number(nudges.birthdayOfferPercent ?? 20)),
    feedbackDelayMinutes: Math.max(10, Number(nudges.feedbackDelayMinutes ?? 60)),
    rebookingWeeks: Math.max(1, Number(nudges.rebookingWeeks ?? 4)),
    loyaltyStep: Math.max(1, Number(nudges.loyaltyStep ?? 100)),
    noShowEnabled: nudges.noShowEnabled !== false,
    abandonedEnabled: nudges.abandonedEnabled !== false,
    birthdayEnabled: nudges.birthdayEnabled !== false,
    feedbackEnabled: nudges.feedbackEnabled !== false,
    rebookingEnabled: nudges.rebookingEnabled !== false,
    loyaltyEnabled: nudges.loyaltyEnabled !== false
  };
}

/** True if an outbound message with this dedupe key has already been sent. */
async function alreadySent(salonId: string, dedupeKey: string): Promise<boolean> {
  const sent = await WhatsAppOutboundModel.countDocuments({ salonId, "metadata.dedupeKey": dedupeKey, status: { $in: ["queued", "sent", "delivered", "read"] } });
  return sent > 0;
}

async function sendOutreach(input: { salonId: string; appointmentId?: string | null; toPhone: string; type: "feedback" | "birthday" | "rebooking" | "loyalty"; body: string; dedupeKey: string; source: string; parameters?: string[] }): Promise<void> {
  const env = loadEnv();
  const templateName = `solastio_${input.type}`;
  if (env.WHATSAPP_PROVIDER !== "mock") {
    const template = await WhatsAppTemplateModel.findOne({ salonId: input.salonId, name: templateName, status: /^approved$/i }).sort({ updatedAt: -1 }).lean();
    if (template) {
      await sendWhatsAppTemplateMessage({
        salonId: input.salonId,
        toPhone: input.toPhone,
        templateName: template.name,
        language: template.language || "en",
        category: template.category || "MARKETING",
        bodyParameters: input.parameters || [],
        metadata: { dedupeKey: input.dedupeKey, source: input.source, templateName: template.name, appointmentId: input.appointmentId || null }
      });
      return;
    }
    if (env.NODE_ENV === "production") throw new Error(`Approved WhatsApp template is required for ${templateName} in production.`);
    logger.warn("Approved WhatsApp outreach template missing; falling back to text send", { salonId: input.salonId, templateName, type: input.type });
  }
  await sendWhatsAppMessage({ salonId: input.salonId, appointmentId: input.appointmentId || null, toPhone: input.toPhone, type: input.type, body: input.body, metadata: { dedupeKey: input.dedupeKey, source: input.source } });
}

/* ── Feature 2: payment-failed recovery ─────────────────────────────────── */

export async function runPaymentFailedRecovery(now = new Date()): Promise<number> {
  const staleMin = new Date(now.getTime() - 24 * 60 * 60_000);
  const appointments = await AppointmentModel.find({
    status: { $in: ["expired", "pending"] },
    paymentStatus: "failed",
    paymentProvider: { $in: ["razorpay", "manual"] },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  const stats = { attempted: appointments.length, sent: 0 };
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone || customer?.marketingOptOut) continue;
    const dedupeKey = `payment_failed:${appointment._id}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    const timezone = await branchTimezone(appointment.salonId, appointment.branchId);
    try {
      await sendWhatsAppMessage({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "payment_failed",
        body: `We noticed your payment for ${appointment.serviceNames.join(", ")} (${money(appointment.value)}) did not go through and your slot has been released.\nReply RESCHEDULE to pick a new slot, or BOOK to start fresh. We'd love to have you.`,
        metadata: { dedupeKey, source: "payment_failed_recovery" }
      });
      stats.sent += 1;
    } catch (error) {
      logger.error("Payment-failed recovery send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return stats.sent;
}

export async function runPaymentHoldExpiryReminders(now = new Date()): Promise<number> {
  const windowStart = new Date(now.getTime() + 5 * 60_000);
  const windowEnd = new Date(now.getTime() + 12 * 60_000);
  const appointments = await AppointmentModel.find({
    status: "pending",
    paymentStatus: "pending",
    paymentProvider: "razorpay",
    paymentLink: { $ne: "" },
    paymentHoldReminderSentAt: null,
    holdExpiresAt: { $gte: windowStart, $lte: windowEnd },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ holdExpiresAt: 1 })
    .limit(200)
    .lean();
  let sent = 0;
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone) continue;
    const dedupeKey = `payment_hold_expiry:${appointment._id}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    try {
      await sendWhatsAppMessage({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "deposit",
        body: `Quick reminder: your slot for ${appointment.serviceNames.join(", ")} will be released soon unless the advance is paid.\nComplete payment here: ${appointment.paymentLink}`,
        metadata: { dedupeKey, source: "payment_hold_expiry" }
      });
      await AppointmentModel.updateOne({ _id: appointment._id }, { $set: { paymentHoldReminderSentAt: now } });
      sent += 1;
    } catch (error) {
      logger.error("Payment hold reminder send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 4: birthday wish + offer ───────────────────────────────────── */

export async function runBirthdayNudges(now = new Date()): Promise<number> {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  let sent = 0;
  const customers = await CustomerModel.find({
    birthday: { $regex: `^${month}-${day}`, $options: "" },
    normalizedPhone: { $exists: true, $ne: "" },
    marketingOptOut: { $ne: true }
  })
    .limit(500)
    .lean();
  for (const customer of customers) {
    const dedupeKey = `birthday:${customer.normalizedPhone}:${now.getFullYear()}`;
    if (await alreadySent(customer.salonId, dedupeKey)) continue;
    const name = customer.name || "there";
    const settings = await nudgeSettingsFor(customer.salonId);
    if (!settings.birthdayEnabled) continue;
    try {
      await sendOutreach({
        salonId: customer.salonId,
        toPhone: customer.normalizedPhone,
        type: "birthday",
        body: `Happy Birthday, ${name}! 🎉 As a Solastio treat, enjoy ${settings.birthdayOfferPercent}% off any service this week when you reply BOOK. Your loyalty points: ${customer.loyaltyPoints || 0}.`,
        dedupeKey,
        source: "birthday",
        parameters: [name, String(customer.loyaltyPoints || 0)]
      });
      sent += 1;
    } catch (error) {
      logger.error("Birthday send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 5: post-visit feedback request ─────────────────────────────── */

export async function runFeedbackNudges(now = new Date()): Promise<number> {
  const windowStart = new Date(now.getTime() - 24 * 60 * 60_000);
  const windowEnd = new Date(now.getTime() + 20 * 60_000);
  const appointments = await AppointmentModel.find({
    status: "completed",
    startAt: { $gte: windowStart, $lte: windowEnd },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ startAt: -1 })
    .limit(200)
    .lean();
  let sent = 0;
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone || customer?.marketingOptOut) continue;
    const settings = await nudgeSettingsFor(appointment.salonId);
    if (!settings.feedbackEnabled) continue;
    const dueAt = new Date(new Date(appointment.startAt).getTime() + settings.feedbackDelayMinutes * 60_000);
    if (dueAt > now || dueAt < windowStart) continue;
    const dedupeKey = `feedback:${appointment._id}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    try {
      const timezone = await branchTimezone(appointment.salonId, appointment.branchId);
      await sendOutreach({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "feedback",
        body: `Hi ${customer?.name || "there"}, hope you loved your ${appointment.serviceNames.join(", ")} visit on ${fmt(appointment.startAt, timezone)}!\nCould you rate us 1-5? Reply a number, or send any feedback. Your insights help us serve you better.`,
        dedupeKey,
        source: "feedback",
        parameters: [customer?.name || "there", appointment.serviceNames.join(", ")]
      });
      await WhatsAppBookingSessionModel.findOneAndUpdate(
        { salonId: appointment.salonId, waPhone: phone },
        { $set: { branchId: appointment.branchId, state: "menu", pendingFeedbackAppointmentId: String(appointment._id), expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60_000) }, $setOnInsert: { profileName: customer?.name || "" } },
        { upsert: true }
      );
      sent += 1;
    } catch (error) {
      logger.error("Feedback send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 6: rebooking recommendation ────────────────────────────────── */

export async function runRebookingNudges(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 60 * 24 * 60 * 60_000);
  const appointments = await AppointmentModel.find({
    status: "completed",
    startAt: { $gte: since, $lte: new Date(now.getTime() - 24 * 60 * 60_000) },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ startAt: -1 })
    .limit(200)
    .lean();
  const shipped = new Set<string>();
  let sent = 0;
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone || customer?.marketingOptOut) continue;
    const key = `${appointment.salonId}:${appointment.customerId}:${(appointment.serviceIds || []).slice().sort().join(",")}`;
    if (shipped.has(key)) continue;
    const dedupeKey = `rebooking:${key}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    try {
      const timezone = await branchTimezone(appointment.salonId, appointment.branchId);
      const settings = await nudgeSettingsFor(appointment.salonId);
      if (!settings.rebookingEnabled) continue;
      const nextDue = new Date(appointment.startAt.getTime() + settings.rebookingWeeks * 7 * 24 * 60 * 60_000);
      await sendOutreach({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "rebooking",
        body: `It's about time for your next ${appointment.serviceNames.join(", ")} session, ${customer?.name || "there"}!\nIdeal next visit is around ${fmt(nextDue, timezone)}. Reply BOOK to schedule it now.`,
        dedupeKey,
        source: "rebooking",
        parameters: [customer?.name || "there", appointment.serviceNames.join(", ")]
      });
      shipped.add(key);
      sent += 1;
    } catch (error) {
      logger.error("Rebooking send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 7: loyalty tier upgrade / reward message ───────────────────── */

export async function runLoyaltyNudges(now = new Date()): Promise<number> {
  const customers = await CustomerModel.find({
    loyaltyPoints: { $gte: 100 },
    normalizedPhone: { $exists: true, $ne: "" },
    marketingOptOut: { $ne: true }
  })
    .limit(200)
    .lean();
  let sent = 0;
  for (const customer of customers) {
    const settings = await nudgeSettingsFor(customer.salonId);
    if (!settings.loyaltyEnabled) continue;
    const dedupeKey = `loyalty_tier:${customer._id}:${Math.floor((customer.loyaltyPoints || 0) / settings.loyaltyStep)}`;
    if (await alreadySent(customer.salonId, dedupeKey)) continue;
    try {
      await sendOutreach({
        salonId: customer.salonId,
        toPhone: customer.normalizedPhone,
        type: "loyalty",
        body: `You've earned ${customer.loyaltyPoints} loyalty points with us, ${customer.name || "there"}!\nYou're on your way to a free service. Reply BOOK to redeem rewards on your next visit.`,
        dedupeKey,
        source: "loyalty_tier",
        parameters: [customer.name || "there", String(customer.loyaltyPoints || 0)]
      });
      sent += 1;
    } catch (error) {
      logger.error("Loyalty send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 8: no-show follow-up ───────────────────────────────────────── */

export async function runNoShowNudges(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const appointments = await AppointmentModel.find({
    status: "no_show",
    startAt: { $gte: since, $lte: now },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ startAt: -1 })
    .limit(200)
    .lean();
  let sent = 0;
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone || customer?.marketingOptOut) continue;
    const settings = await nudgeSettingsFor(appointment.salonId);
    if (!settings.noShowEnabled) continue;
    const dedupeKey = `no_show:${appointment._id}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    try {
      const timezone = await branchTimezone(appointment.salonId, appointment.branchId);
      const when = appointment.startAt ? ` for ${fmt(new Date(appointment.startAt), timezone)}` : "";
      const value = appointment.value ? ` (${money(appointment.value)})` : "";
      await sendWhatsAppMessage({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "no_show",
        body: `We missed you at your ${appointment.serviceNames.join(", ")} appointment on ${fmt(appointment.startAt, timezone)}, ${customer?.name || "there"}.\nNo worries — reply RESCHEDULE to grab a fresh slot, and we'll waive the missed visit.`,
        metadata: { dedupeKey, source: "no_show" }
      });
      sent += 1;
    } catch (error) {
      logger.error("No-show send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 9: waitlist opportunity alerts ─────────────────────────────── */

export async function runWaitlistNudges(now = new Date()): Promise<number> {
  const expiredOffers = await WaitlistModel.find({ status: "offered", opportunityExpiresAt: { $lte: now }, offeredAppointmentId: { $ne: "" } }).limit(200).lean();
  for (const entry of expiredOffers) {
    await WaitlistModel.updateOne({ _id: entry._id }, { $set: { status: "expired" } });
    await AppointmentModel.updateOne({ _id: entry.offeredAppointmentId, salonId: entry.salonId, status: "pending" }, { $set: { status: "expired" } });
    await AppointmentSlotLockModel.deleteMany({ salonId: entry.salonId, appointmentId: entry.offeredAppointmentId || "" });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const entries = await WaitlistModel.find({ status: "waiting", notified: false, $or: [{ date: "" }, { date: today }] })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();
  let sent = 0;
  for (const entry of entries) {
    const dedupeKey = `waitlist_offer:${entry._id}`;
    if (await alreadySent(entry.salonId, dedupeKey)) continue;
    try {
      const customerName = entry.customerId ? (await CustomerModel.findById(entry.customerId).lean())?.name : null;
      await sendWhatsAppMessage({
        salonId: entry.salonId,
        appointmentId: entry.offeredAppointmentId || null,
        toPhone: entry.customerPhone,
        type: "waitlist",
        body: `Great news, ${customerName || "there"}!\nA spot just opened for ${entry.serviceNames.join(", ") || "your service"} on your waitlisted date.\nReply BOOK within 15 minutes to claim it before we offer it to someone else.`,
        metadata: { dedupeKey, source: "waitlist", waitlistId: String(entry._id) }
      });
      await WaitlistModel.updateOne({ _id: entry._id }, { $set: { status: "offered", notified: true, opportunityExpiresAt: new Date(now.getTime() + 15 * 60_000) } });
      sent += 1;
    } catch (error) {
      logger.error("Waitlist send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

/* ── Feature 11: abandoned-booking recovery ─────────────────────────────── */

export async function runAbandonedBookingNudges(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 12 * 60_000);
  const appointments = await AppointmentModel.find({
    status: "pending",
    holdExpiresAt: null,
    paymentStatus: "pending",
    createdAt: { $lte: cutoff },
    customerId: { $exists: true, $ne: "" }
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  let sent = 0;
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone || customer?.marketingOptOut) continue;
    const settings = await nudgeSettingsFor(appointment.salonId);
    if (!settings.abandonedEnabled) continue;
    const dedupeKey = `abandoned:${appointment._id}`;
    if (await alreadySent(appointment.salonId, dedupeKey)) continue;
    try {
      const timezone = await branchTimezone(appointment.salonId, appointment.branchId);
      const when = appointment.startAt ? ` for ${fmt(new Date(appointment.startAt), timezone)}` : "";
      const value = appointment.value ? ` (${money(appointment.value)})` : "";
      const body = `Still want ${appointment.serviceNames.join(", ")}${value}${when}, ${customer?.name || "there"}?\nReply YES to continue, RESCHEDULE to move it, or BOOK to pick another time.`;
      await sendWhatsAppMessage({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "abandoned",
        body,
        metadata: { dedupeKey, source: "abandoned_booking" }
      });
      sent += 1;
    } catch (error) {
      logger.error("Abandoned send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sent;
}

export async function runAllNudges(): Promise<Record<string, number>> {
  const [paymentFailed, paymentHoldExpiry, birthday, feedback, rebooking, loyalty, noShow, waitlist, abandoned] = await Promise.all([
    runPaymentFailedRecovery(),
    runPaymentHoldExpiryReminders(),
    runBirthdayNudges(),
    runFeedbackNudges(),
    runRebookingNudges(),
    runLoyaltyNudges(),
    runNoShowNudges(),
    runWaitlistNudges(),
    runAbandonedBookingNudges()
  ]);
  return { paymentFailed, paymentHoldExpiry, birthday, feedback, rebooking, loyalty, noShow, waitlist, abandoned };
}

export function startWhatsAppNudgesScheduler(intervalMs = 10 * 60_000): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAllNudges();
      if (Object.values(result).some((value) => value > 0)) logger.info("WhatsApp nudge scheduler processed", result);
    } catch (error) {
      logger.error("WhatsApp nudge scheduler failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return timer;
}

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const result = await Promise.all([
    runPaymentFailedRecovery(),
    runPaymentHoldExpiryReminders(),
    runBirthdayNudges(),
    runFeedbackNudges(),
    runRebookingNudges(),
    runLoyaltyNudges(),
    runNoShowNudges(),
    runWaitlistNudges(),
    runAbandonedBookingNudges()
  ]).then(([paymentFailed, paymentHoldExpiry, birthday, feedback, rebooking, loyalty, noShow, waitlist, abandoned]) => ({ paymentFailed, paymentHoldExpiry, birthday, feedback, rebooking, loyalty, noShow, waitlist, abandoned }));
  logger.info("WhatsApp nudge job complete", result);
  await disconnectMongo();
}

if (require.main === module) {
  main()
    .then(() => disconnectMongo())
    .catch((error) => {
      logger.error("WhatsApp nudge job failed", { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
}
