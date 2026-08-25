import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import type { Env } from "../../src/config/env";
import { setEnvForTesting } from "../../src/config/env";
import { createApp } from "../../src/app";

/**
 * Boots MongoDB as a single-node replica set so transactions behave exactly
 * like production (per architecture requirement — never mocked).
 *
 * The dbPath is forced onto the repo drive (D:) because the system temp drive
 * may not have enough free space for WiredTiger journal pre-allocation.
 */
let replSet: MongoMemoryReplSet | null = null;
const DATA_ROOT = path.join(__dirname, "..", "..", ".mongodata");
// Unique directory per run so a locked leftover from a crashed run can never block startup.
const TEST_DB_PATH = path.join(DATA_ROOT, `run-${process.pid}-${Date.now()}`);

export async function startTestMongo(): Promise<string> {
  if (!replSet) {
    fs.mkdirSync(TEST_DB_PATH, { recursive: true });
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [{ dbPath: TEST_DB_PATH, storageEngine: "wiredTiger" }],
      replSet: { count: 1, storageEngine: "wiredTiger" }
    });
  }
  return replSet.getUri("aura_saas_test");
}

export async function stopTestMongo(): Promise<void> {
  if (replSet) {
    await replSet.stop();
    replSet = null;
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch {
      // Best effort — a lingering handle must not fail the test run.
    }
  }
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  const base: Env = {
    NODE_ENV: "test",
    PORT: 0,
    MONGODB_URI: "unused",
    MONGODB_MAX_POOL_SIZE: 10,
    MONGODB_AUTO_INDEX: true,
    JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef",
    JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef",
    CSRF_SECRET: "test-csrf-secret-0123456789abcdef",
    ACCESS_TOKEN_TTL_MINUTES: 15,
    REFRESH_TOKEN_TTL_DAYS: 14,
    CORS_ORIGINS: "http://127.0.0.1:4320",
    COOKIE_SECURE: false,
    COOKIE_SAMESITE: "lax",
    META_GRAPH_API_BASE_URL: "https://graph.facebook.com",
    META_GRAPH_API_VERSION: "v21.0",
    META_API_VERSION: undefined,
    META_APP_ID: undefined,
    META_CONFIG_ID: undefined,
    META_CREDENTIAL_ENCRYPTION_KEY: undefined,
    META_WEBHOOK_APP_SECRET: undefined,
    SHOPIFY_API_KEY: undefined,
    SHOPIFY_API_SECRET: undefined,
    SHOPIFY_SCOPES: "read_customers,read_orders,read_products,read_checkouts,write_webhooks",
    SHOPIFY_APP_URL: undefined,
    SHOPIFY_JWT_SECRET: "test-shopify-jwt-secret-0123456789abcdef",
    SHOPIFY_ADMIN_EMAIL: "admin@test.com",
    SHOPIFY_ADMIN_PASSWORD: "admin123456",
    SHOPIFY_CLIENT_EMAIL: "",
    SHOPIFY_CLIENT_PASSWORD: "",
    RAZORPAY_KEY_ID: undefined,
    RAZORPAY_KEY_SECRET: undefined,
    RAZORPAY_WEBHOOK_SECRET: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: "gpt-4o-mini",
    SEED_SALON_ID: "tenant_aura",
    SEED_SALON_NAME: "Aura Shine Salon & Wellness",
    SALON_TIMEZONE: "Asia/Kolkata",
    SEED_OWNER_LOGIN: "owner",
    SEED_OWNER_PASSWORD: "owner@123",
    SEED_STAFF_LOGIN: "reception",
    SEED_STAFF_PASSWORD: "staff@123",
    WHATSAPP_PROVIDER: "mock",
    WEB_PUSH_PUBLIC_KEY: undefined,
    WEB_PUSH_PRIVATE_KEY: undefined
  };
  const merged = { ...base, ...overrides } as Env;
  setEnvForTesting(merged);
  return merged;
}

export interface TestWorld {
  app: ReturnType<typeof createApp>;
}

/** Fresh database + app per suite. */
export async function createTestWorld(envOverrides: Partial<Env> = {}): Promise<TestWorld> {
  const uri = await startTestMongo();
  testEnv({ ...envOverrides, MONGODB_URI: uri });
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri);
  }
  return { app: createApp() };
}

export async function destroyTestWorld(): Promise<void> {
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
}
