import "dotenv/config";
import { z } from "zod";

const PLACEHOLDER_VALUES = new Set(["change-me", "replace-me", "replace-with-strong-access-secret", "replace-with-strong-refresh-secret", "replace-with-strong-csrf-secret"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/aura_saas?replicaSet=rs0"),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MONGODB_AUTO_INDEX: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : ["1", "true", "yes"].includes(value.toLowerCase()))),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  CSRF_SECRET: z.string().min(16),

  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

  CORS_ORIGINS: z.string().default("http://127.0.0.1:4320,http://localhost:4320"),
  COOKIE_DOMAIN: z.string().optional(),
  /** Cross-site deployments (frontend on Vercel, API elsewhere) must set "none" so the refresh cookie travels. */
  COOKIE_SAMESITE: z.enum(["lax", "none", "strict"]).default("lax"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((value) => ["1", "true", "yes"].includes(value.toLowerCase())),

  SEED_SALON_ID: z.string().default("tenant_aura"),
  SEED_SALON_NAME: z.string().default("Aura Shine Salon & Wellness"),
  SALON_TIMEZONE: z.string().default("Asia/Kolkata"),
  SEED_OWNER_LOGIN: z.string().default("owner"),
  SEED_OWNER_PASSWORD: z.string().default("owner@123"),
  SEED_STAFF_LOGIN: z.string().default("reception"),
  SEED_STAFF_PASSWORD: z.string().default("staff@123"),

  WHATSAPP_PROVIDER: z.enum(["mock", "meta", "meta_test", "meta_production"]).default("mock"),
  WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  META_GRAPH_API_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  META_GRAPH_API_VERSION: z.string().default("v21.0"),
  META_API_VERSION: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_CONFIG_ID: z.string().optional(),
  META_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  META_WABA_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_APP_SECRET: z.string().optional(),
  VERIFY_TOKEN: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini")
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;

  const secretEntries = [
    ["JWT_ACCESS_SECRET", env.JWT_ACCESS_SECRET],
    ["JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET],
    ["CSRF_SECRET", env.CSRF_SECRET]
  ] as const;
  for (const [key, value] of secretEntries) {
    if (value.length < 32 || PLACEHOLDER_VALUES.has(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Production secrets must be unique, non-placeholder values with at least 32 characters." });
    }
  }

  if (/127\.0\.0\.1|localhost|mongodb-memory-server/i.test(env.MONGODB_URI)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["MONGODB_URI"], message: "Production must use a persistent MongoDB URI, not localhost or memory storage." });
  }
  if (!env.COOKIE_SECURE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["COOKIE_SECURE"], message: "Production must set COOKIE_SECURE=true behind HTTPS." });
  }
  if (env.CORS_ORIGINS.split(",").some((origin) => /localhost|127\.0\.0\.1/i.test(origin))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "Production CORS_ORIGINS must contain only real HTTPS application origins." });
  }
  for (const [key, value] of [["SEED_OWNER_PASSWORD", env.SEED_OWNER_PASSWORD], ["SEED_STAFF_PASSWORD", env.SEED_STAFF_PASSWORD]] as const) {
    if (value.length < 12 || PLACEHOLDER_VALUES.has(value) || ["owner@123", "staff@123"].includes(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Production seed passwords must be rotated before first seed." });
    }
  }
  if (env.WHATSAPP_PROVIDER === "meta") {
    for (const key of ["META_WABA_PHONE_NUMBER_ID", "META_WHATSAPP_TOKEN", "META_APP_SECRET"] as const) {
      if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required when WHATSAPP_PROVIDER=meta." });
    }
    if (!env.META_WEBHOOK_VERIFY_TOKEN && !env.VERIFY_TOKEN) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["VERIFY_TOKEN"], message: "Required when WHATSAPP_PROVIDER=meta." });
  }
  if (env.WHATSAPP_PROVIDER === "meta_production" || env.WHATSAPP_PROVIDER === "meta_test") {
    for (const key of ["META_APP_ID", "META_APP_SECRET", "META_CONFIG_ID"] as const) {
      if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required for Embedded Signup WhatsApp providers." });
    }
    if (!env.META_WEBHOOK_VERIFY_TOKEN && !env.VERIFY_TOKEN) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["VERIFY_TOKEN"], message: "Required for Embedded Signup WhatsApp providers." });
  }
  if (Boolean(env.WEB_PUSH_PUBLIC_KEY) !== Boolean(env.WEB_PUSH_PRIVATE_KEY)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["WEB_PUSH_PUBLIC_KEY"], message: "Web push public/private keys must be configured together." });
  }
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server environment configuration -> ${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Test hook — allows tests to inject a validated environment before first use. */
export function setEnvForTesting(env: Env): void {
  cachedEnv = env;
}

export function isProduction(): boolean {
  return loadEnv().NODE_ENV === "production";
}
