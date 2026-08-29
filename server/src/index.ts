import http from "node:http";
import bcrypt from "bcryptjs";
import { loadEnv } from "./config/env";
import { connectMongo, disconnectMongo } from "./config/mongo";
import { createApp } from "./app";
import { logger } from "./shared/logger";
import { startShopifyAutomationScheduler } from "./jobs/shopify-automation";
import { startWhatsAppReminderScheduler } from "./jobs/whatsapp-reminders";
import { ShopifyUserModel } from "./models/shopify-user.model";

async function ensureShopifyUsers(): Promise<void> {
  const env = loadEnv();
  const entries: Array<{ email: string; password: string; name: string; role: "admin" | "client"; shopDomain: string }> = [
    { email: env.SHOPIFY_ADMIN_EMAIL, password: env.SHOPIFY_ADMIN_PASSWORD, name: "Shopify Admin", role: "admin" as const, shopDomain: "admin" }
  ];
  if (env.SHOPIFY_CLIENT_EMAIL && env.SHOPIFY_CLIENT_PASSWORD) {
    entries.push({ email: env.SHOPIFY_CLIENT_EMAIL, password: env.SHOPIFY_CLIENT_PASSWORD, name: "Shopify Client", role: "client" as const, shopDomain: "client" });
  }
  for (const entry of entries) {
    const loginIdNormalized = entry.email.trim().toLowerCase();
    const existing = await ShopifyUserModel.findOne({ shopDomain: entry.shopDomain, loginIdNormalized });
    if (existing) continue;
    await ShopifyUserModel.create({
      shopDomain: entry.shopDomain,
      loginId: entry.email,
      loginIdNormalized,
      email: loginIdNormalized,
      name: entry.name,
      passwordHash: await bcrypt.hash(entry.password, 12),
      role: entry.role,
      status: "active"
    });
    logger.info(`Shopify user created: ${entry.email} (${entry.role})`);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  logger.info("MongoDB connected", { uri: env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@") });

  await ensureShopifyUsers();

  const app = createApp();
  const server = http.createServer(app);
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  server.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`Aura Staff server listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });
  const shopifyAutomationTimer = startShopifyAutomationScheduler();
  const reminderSchedulerTimer = startWhatsAppReminderScheduler();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    clearInterval(shopifyAutomationTimer);
    clearInterval(reminderSchedulerTimer);
    server.close(() => {
      disconnectMongo()
        .catch((error) => logger.error("MongoDB disconnect failed", { error: String(error) }))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Fatal startup error", { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  process.exit(1);
});
