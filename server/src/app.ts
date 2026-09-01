import express, { type Express } from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { json } from "express";
import { loadEnv } from "./config/env";
import { csrfGuard } from "./middleware/csrf";
import { globalLimiter } from "./middleware/rate-limit";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { idempotencyGuard } from "./middleware/idempotency";
import { authRouter } from "./modules/auth/auth.routes";
import { staffOsRouter, staffSelfRouter, teamChatRouter } from "./modules/staff/staff.routes";
import { appointmentsRouter } from "./modules/appointments/appointments.routes";
import { metaWebhookRouter, whatsappRouter } from "./modules/whatsapp/whatsapp.routes";
import { mobileRouter } from "./modules/push/push.routes";
import { catalogRouter } from "./modules/catalog/catalog.routes";
import { realtimeRouter } from "./modules/realtime/realtime.routes";
import { ownerConsoleRouter } from "./modules/owner-console/owner-console.routes";
import { shopifyAutomationRouter, shopifyWebhookRouter } from "./modules/shopify-automation/shopify-automation.routes";
import { shopifyProductAuthRouter } from "./modules/shopify-product/shopify-product-auth.routes";
import { shopifyProductAdminRouter } from "./modules/shopify-product/shopify-product-admin.routes";
import { shopifyProductClientRouter } from "./modules/shopify-product/shopify-product-client.routes";
import { selfBookingRouter } from "./modules/self-booking/self-booking.routes";
import { ok } from "./shared/http";

/** Mutating endpoints that cannot carry CSRF headers (native app refresh/logout, provider webhooks, public self-booking). */
const CSRF_EXEMPT_PATHS = [
  /^\/auth\/refresh$/,
  /^\/auth\/logout$/,
  /^\/shopify-api\/auth(?:\/|$)/,
  /^\/whatsapp(?:\/|$)/,
  /^\/shopify-automation\/webhooks(?:\/|$)/,
  /^\/self-booking(?:\/|$)/
];

function corsOptions() {
  const env = loadEnv();
  const allowlist = env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    origin(origin: string | undefined, callback: (error: Error | null, value?: boolean) => void) {
      // Non-browser clients (native APK via CapacitorHttp) send no Origin header.
      if (!origin) return callback(null, true);
      if (allowlist.includes(origin)) return callback(null, true);
      callback(new Error("Origin is not allowed by CORS."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-auth-token", "x-csrf-token", "Idempotency-Key"],
    exposedHeaders: ["content-disposition"]
  };
}

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(corsOptions()));
  app.use(cookieParser());
  app.use(json({
    limit: "2mb",
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: string }).rawBody = buffer.toString("utf8");
    }
  }));
  app.use(globalLimiter);

  // Everything lives under /api/v1 — the base path the frontend already speaks.
  const api = express.Router();
  api.get("/health", (_req, res) => ok(res, { status: "ok", time: new Date().toISOString() }));
  api.get("/ready", (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    ok(res, { status: ready ? "ready" : "not_ready", mongoReadyState: mongoose.connection.readyState }, ready ? 200 : 503);
  });
  api.use(csrfGuard(CSRF_EXEMPT_PATHS));
  api.use(idempotencyGuard());

  api.use("/auth", authRouter);
  api.use("/staff-os", staffOsRouter);
  api.use("/staff-self", staffSelfRouter);
  api.use("/team-chat", teamChatRouter);
  api.use("/appointments", appointmentsRouter);
  api.use("/catalog", catalogRouter);
  api.use("/mobile", mobileRouter);
  api.use("/realtime", realtimeRouter);
  api.use("/whatsapp", whatsappRouter);
  api.use("/owner-console", ownerConsoleRouter);
  api.use("/shopify-automation", shopifyAutomationRouter);
  api.use("/shopify-api/auth", shopifyProductAuthRouter);
  api.use("/shopify-api/admin", shopifyProductAdminRouter);
  api.use("/shopify-api/client", shopifyProductClientRouter);
  api.use("/self-booking", selfBookingRouter);

  app.use("/api/v1", api);
  app.use("/webhook", metaWebhookRouter);
  app.use("/shopify/webhooks", shopifyWebhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
