import { loadEnv } from "../config/env";
import { connectMongo, disconnectMongo } from "../config/mongo";
import { logger } from "../shared/logger";

function requireEnv(name: string, value: string | undefined, missing: string[]): void {
  if (!value?.trim()) missing.push(name);
}

function configured(name: string, value: string | undefined): boolean {
  return Boolean(value?.trim());
}

async function main(): Promise<void> {
  const env = loadEnv();
  const missing: string[] = [];

  if (env.NODE_ENV !== "production") missing.push("NODE_ENV=production");
  if (env.MONGODB_AUTO_INDEX !== false) missing.push("MONGODB_AUTO_INDEX=false");
  if (env.COOKIE_SAMESITE === "none" && !env.COOKIE_SECURE) missing.push("COOKIE_SECURE=true when COOKIE_SAMESITE=none");

  if (env.WHATSAPP_PROVIDER === "meta") {
    requireEnv("META_WABA_PHONE_NUMBER_ID", env.META_WABA_PHONE_NUMBER_ID, missing);
    requireEnv("META_WHATSAPP_TOKEN", env.META_WHATSAPP_TOKEN, missing);
    requireEnv("META_APP_SECRET", env.META_APP_SECRET, missing);
    requireEnv("VERIFY_TOKEN or META_WEBHOOK_VERIFY_TOKEN", env.VERIFY_TOKEN || env.META_WEBHOOK_VERIFY_TOKEN, missing);
  }
  if (env.WHATSAPP_PROVIDER === "meta_test" || env.WHATSAPP_PROVIDER === "meta_production") {
    requireEnv("META_APP_ID", env.META_APP_ID, missing);
    requireEnv("META_APP_SECRET", env.META_APP_SECRET, missing);
    requireEnv("META_CONFIG_ID", env.META_CONFIG_ID, missing);
    requireEnv("META_CREDENTIAL_ENCRYPTION_KEY", env.META_CREDENTIAL_ENCRYPTION_KEY, missing);
    requireEnv("VERIFY_TOKEN or META_WEBHOOK_VERIFY_TOKEN", env.VERIFY_TOKEN || env.META_WEBHOOK_VERIFY_TOKEN, missing);
  }

  if (configured("RAZORPAY_KEY_ID", env.RAZORPAY_KEY_ID) || configured("RAZORPAY_KEY_SECRET", env.RAZORPAY_KEY_SECRET) || configured("RAZORPAY_WEBHOOK_SECRET", env.RAZORPAY_WEBHOOK_SECRET)) {
    requireEnv("RAZORPAY_KEY_ID", env.RAZORPAY_KEY_ID, missing);
    requireEnv("RAZORPAY_KEY_SECRET", env.RAZORPAY_KEY_SECRET, missing);
    requireEnv("RAZORPAY_WEBHOOK_SECRET", env.RAZORPAY_WEBHOOK_SECRET, missing);
  }

  if (env.WHATSAPP_CONCIERGE_ENABLED) requireEnv("OPENAI_API_KEY", env.OPENAI_API_KEY, missing);
  if (configured("WEB_PUSH_PUBLIC_KEY", env.WEB_PUSH_PUBLIC_KEY) || configured("WEB_PUSH_PRIVATE_KEY", env.WEB_PUSH_PRIVATE_KEY)) {
    requireEnv("WEB_PUSH_PUBLIC_KEY", env.WEB_PUSH_PUBLIC_KEY, missing);
    requireEnv("WEB_PUSH_PRIVATE_KEY", env.WEB_PUSH_PRIVATE_KEY, missing);
  }

  if (missing.length) throw new Error(`Production configuration is incomplete -> ${missing.join(", ")}`);

  await connectMongo(env.MONGODB_URI);
  logger.info("Production configuration check passed", {
    nodeEnv: env.NODE_ENV,
    cookieSecure: env.COOKIE_SECURE,
    cookieSameSite: env.COOKIE_SAMESITE,
    corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    whatsappProvider: env.WHATSAPP_PROVIDER,
    razorpayConfigured: configured("RAZORPAY_KEY_ID", env.RAZORPAY_KEY_ID),
    openAiConfigured: configured("OPENAI_API_KEY", env.OPENAI_API_KEY),
    webPushConfigured: configured("WEB_PUSH_PUBLIC_KEY", env.WEB_PUSH_PUBLIC_KEY)
  });
  await disconnectMongo();
}

main().catch((error) => {
  logger.error("Production configuration check failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
