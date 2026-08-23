import { MongoMemoryReplSet } from "mongodb-memory-server";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { connectMongo } from "./config/mongo";
import { setEnvForTesting } from "./config/env";
import { seed } from "./seed";

async function main(): Promise<void> {
  const dbPath = path.join(process.cwd(), ".mongodata", `dev-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath, storageEngine: "wiredTiger", args: ["--wiredTigerCacheSizeGB", "0.25"] }],
    replSet: { count: 1, storageEngine: "wiredTiger" }
  });
  const uri = replSet.getUri("aura_dev");

  setEnvForTesting({
    NODE_ENV: "development",
    PORT: 4000,
    MONGODB_URI: uri,
    MONGODB_MAX_POOL_SIZE: 10,
    MONGODB_AUTO_INDEX: true,
    JWT_ACCESS_SECRET: "dev-access-secret-please-change-0123456789",
    JWT_REFRESH_SECRET: "dev-refresh-secret-please-change-0123456789",
    CSRF_SECRET: "dev-csrf-secret-please-change-0123456789",
    ACCESS_TOKEN_TTL_MINUTES: 15,
    REFRESH_TOKEN_TTL_DAYS: 14,
    CORS_ORIGINS: "http://127.0.0.1:4320,http://localhost:4320",
    COOKIE_SECURE: false,
    COOKIE_SAMESITE: "lax",
    SEED_SALON_ID: "tenant_aura",
    SEED_SALON_NAME: "Aura Shine Salon & Wellness",
    SALON_TIMEZONE: "Asia/Kolkata",
    SEED_OWNER_LOGIN: "owner",
    SEED_OWNER_PASSWORD: "owner@123",
    SEED_STAFF_LOGIN: "reception",
    SEED_STAFF_PASSWORD: "staff@123",
    WHATSAPP_PROVIDER: "mock",
    META_GRAPH_API_BASE_URL: "https://graph.facebook.com",
    META_API_VERSION: undefined,
    META_APP_ID: undefined,
    META_CONFIG_ID: undefined,
    META_CREDENTIAL_ENCRYPTION_KEY: undefined,
    META_WEBHOOK_APP_SECRET: undefined,
    WEB_PUSH_PUBLIC_KEY: undefined,
    WEB_PUSH_PRIVATE_KEY: undefined,
    META_GRAPH_API_VERSION: "v21.0"
  });

  await connectMongo(uri);
  await seed({ disconnect: false });
  const app = createApp();
  const server = app.listen(4000, "127.0.0.1", () => {
    console.log("API ready: http://127.0.0.1:4000/api/v1");
    console.log("Login staff: tenant_aura / reception / staff@123");
  });

  const shutdown = async () => {
    server.close();
    await replSet.stop();
    try { fs.rmSync(dbPath, { recursive: true, force: true }); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
