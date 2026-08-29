import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { logger } from "../shared/logger";
import { AppointmentModel } from "../models/appointment.model";
import { CustomerModel } from "../models/customer.model";
import { BranchModel } from "../models/branch.model";
import { sendWhatsAppMessage } from "../modules/whatsapp/whatsapp.service";

const REMINDER_WINDOW_START_HOURS = 20;
const REMINDER_WINDOW_END_HOURS = 26;

export async function runDueReminderNudges(): Promise<{ attempted: number; sent: number; suppressed: number; failed: number }> {
  const now = Date.now();
  const windowStart = new Date(now + REMINDER_WINDOW_START_HOURS * 60 * 60_000);
  const windowEnd = new Date(now + REMINDER_WINDOW_END_HOURS * 60 * 60_000);
  const appointments = await AppointmentModel.find({
    reminderOptIn: true,
    whatsappReminderSentAt: null,
    status: { $in: ["booked", "confirmed"] },
    startAt: { $gt: windowStart, $lt: windowEnd }
  })
    .limit(50)
    .lean();
  const stats = { attempted: appointments.length, sent: 0, suppressed: 0, failed: 0 };
  for (const appointment of appointments) {
    const customer = appointment.customerId ? await CustomerModel.findById(appointment.customerId).lean() : null;
    const phone = customer?.normalizedPhone || "";
    if (!phone) {
      stats.failed += 1;
      continue;
    }
    if (customer?.marketingOptOut) {
      await AppointmentModel.updateOne({ _id: appointment._id }, { $set: { whatsappReminderSentAt: now } });
      stats.suppressed += 1;
      continue;
    }
    const branch = await BranchModel.findOne({ _id: appointment.branchId, salonId: appointment.salonId }).lean();
    const timezone = branch?.timezone || loadEnv().SALON_TIMEZONE || "Asia/Kolkata";
    const timeLabel = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(appointment.startAt));
    const dateLabel = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "short", day: "2-digit", month: "short" }).format(new Date(appointment.startAt));
    try {
      await sendWhatsAppMessage({
        salonId: appointment.salonId,
        appointmentId: String(appointment._id),
        toPhone: phone,
        type: "reminder",
        body: `Reminder: ${appointment.serviceNames.join(", ")} with us on ${dateLabel} at ${timeLabel}. Reply "RESCHEDULE" or "CANCEL" anytime to change it.`
      });
      await AppointmentModel.updateOne({ _id: appointment._id }, { $set: { whatsappReminderSentAt: now } });
      stats.sent += 1;
    } catch (error) {
      stats.failed += 1;
      logger.error("WhatsApp reminder send failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return stats;
}

export function startWhatsAppReminderScheduler(intervalMs = 300_000): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDueReminderNudges();
      if (result.attempted) logger.info("WhatsApp reminder scheduler processed appointments", result);
    } catch (error) {
      logger.error("WhatsApp reminder scheduler failed", { error: error instanceof Error ? error.message : String(error) });
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
  const result = await runDueReminderNudges();
  logger.info("WhatsApp reminder job complete", result);
  await disconnectMongo();
}

if (process.argv[1]?.endsWith("whatsapp-reminders.ts") || process.argv[1]?.endsWith("whatsapp-reminders.js")) {
  main().catch((error) => {
    logger.error("WhatsApp reminder job failed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}