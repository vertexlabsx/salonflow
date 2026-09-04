import { loadEnv } from "../config/env";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { retryFailedMessages } from "../modules/whatsapp/whatsapp.service";
import { logger } from "../shared/logger";

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const result = await retryFailedMessages();
  logger.info("WhatsApp retry job complete", result);
  await disconnectMongo();
}

main().catch((error) => {
  logger.error("WhatsApp retry job failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
