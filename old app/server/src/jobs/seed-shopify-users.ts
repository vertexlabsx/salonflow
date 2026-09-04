import bcrypt from "bcryptjs";
import { loadEnv } from "../config/env";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { ShopifyUserModel } from "../models/shopify-user.model";
import { logger } from "../shared/logger";

async function seed() {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);

  const adminEmail = env.SHOPIFY_ADMIN_EMAIL;
  const adminPassword = env.SHOPIFY_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    logger.error("SHOPIFY_ADMIN_EMAIL and SHOPIFY_ADMIN_PASSWORD must be set in environment.");
    process.exit(1);
  }

  const adminHash = await bcrypt.hash(adminPassword, 12);
  await ShopifyUserModel.findOneAndUpdate(
    { shopDomain: "admin", loginIdNormalized: adminEmail.toLowerCase() },
    {
      $setOnInsert: {
        shopDomain: "admin",
        loginId: adminEmail,
        loginIdNormalized: adminEmail.toLowerCase(),
        email: adminEmail.toLowerCase(),
        name: "Shopify Admin",
        passwordHash: adminHash,
        role: "admin",
        status: "active"
      }
    },
    { upsert: true }
  );
  logger.info(`Shopify admin user seeded: ${adminEmail}`);

  const clientEmail = env.SHOPIFY_CLIENT_EMAIL;
  const clientPassword = env.SHOPIFY_CLIENT_PASSWORD;
  if (clientEmail && clientPassword) {
    const clientHash = await bcrypt.hash(clientPassword, 12);
    await ShopifyUserModel.findOneAndUpdate(
      { shopDomain: "client", loginIdNormalized: clientEmail.toLowerCase() },
      {
        $setOnInsert: {
          shopDomain: "client",
          loginId: clientEmail,
          loginIdNormalized: clientEmail.toLowerCase(),
          email: clientEmail.toLowerCase(),
          name: "Shopify Client",
          passwordHash: clientHash,
          role: "client",
          status: "active"
        }
      },
      { upsert: true }
    );
    logger.info(`Shopify client user seeded: ${clientEmail}`);
  }

  await disconnectMongo();
  logger.info("Shopify user seed completed.");
}

seed().catch((error) => {
  logger.error("Shopify user seed failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
