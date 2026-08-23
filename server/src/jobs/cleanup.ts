import { loadEnv } from "../config/env";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { WhatsAppBookingSessionModel } from "../models/whatsapp-booking-session.model";
import { WhatsAppInboundModel } from "../models/whatsapp-inbound.model";
import { WhatsAppOutboundModel } from "../models/whatsapp-outbound.model";
import { logger } from "../shared/logger";

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const now = new Date();
  const inboundCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
  const outboundCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60_000);
  const [sessions, inbound, outbound] = await Promise.all([
    WhatsAppBookingSessionModel.deleteMany({ expiresAt: { $lt: now }, state: { $ne: "completed" } }),
    WhatsAppInboundModel.deleteMany({ createdAt: { $lt: inboundCutoff }, appointmentId: null }),
    WhatsAppOutboundModel.deleteMany({ createdAt: { $lt: outboundCutoff }, status: { $in: ["sent", "delivered", "read", "failed"] } })
  ]);
  logger.info("Cleanup complete", { sessions: sessions.deletedCount, inbound: inbound.deletedCount, outbound: outbound.deletedCount });
  await disconnectMongo();
}

main().catch((error) => {
  logger.error("Cleanup failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
