import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { AppointmentModel } from "../models/appointment.model";
import { CustomerModel } from "../models/customer.model";
import { sendWhatsAppMessage } from "../modules/whatsapp/whatsapp.service";
import { logger } from "../shared/logger";

export async function sendDueAppointmentReminders(now = new Date()): Promise<number> {
  const from = new Date(now.getTime());
  const to = new Date(now.getTime() + 24 * 60 * 60_000);
  const appointments = await AppointmentModel.find({
    status: { $in: ["booked", "confirmed"] },
    startAt: { $gte: from, $lte: to },
    whatsappReminderSentAt: null,
    customerId: { $exists: true, $ne: "" }
  }).limit(500);

  let sent = 0;
  for (const appointment of appointments) {
    const customer = await CustomerModel.findById(appointment.customerId);
    if (!customer?.normalizedPhone) continue;
    await sendWhatsAppMessage({
      salonId: appointment.salonId,
      appointmentId: String(appointment._id),
      toPhone: customer.normalizedPhone,
      type: "reminder",
      body: `Reminder: your appointment for ${appointment.serviceNames.join(", ") || "service"} is at ${appointment.startAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`
    });
    appointment.whatsappReminderSentAt = new Date();
    await appointment.save();
    sent++;
  }
  return sent;
}

if (require.main === module) {
  connectMongo(loadEnv().MONGODB_URI)
    .then(() => sendDueAppointmentReminders())
    .then(async (count) => {
      logger.info("Appointment reminders processed", { count });
      await disconnectMongo();
    })
    .catch((error) => {
      logger.error("Appointment reminder job failed", { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
}
