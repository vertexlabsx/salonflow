import { loadEnv } from "../config/env";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { logger } from "../shared/logger";

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  logger.info("Production configuration check passed", {
    nodeEnv: env.NODE_ENV,
    cookieSecure: env.COOKIE_SECURE,
    corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    whatsappProvider: env.WHATSAPP_PROVIDER
  });
  await disconnectMongo();
}

main().catch((error) => {
  logger.error("Production configuration check failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
