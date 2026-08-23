import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../../middleware/auth.middleware";
import { requirePermissions } from "../../../middleware/rbac";
import { ApiError, asyncHandler, ok } from "../../../shared/http";
import { audit } from "../../../shared/audit";
import { WhatsAppConnectionModel } from "../../../models/whatsapp-connection.model";
import { createEmbeddedSignupState, consumeEmbeddedSignupState } from "./oauth-state.service";
import { embeddedSignupConfigured, metaConfig } from "./meta-config";
import { exchangeEmbeddedSignupCode, fetchWabaPhoneNumbers, subscribeWabaToWebhooks } from "./meta-client";
import { disconnectConnection, safeConnection, upsertMetaConnection } from "./connection.service";

const READ = ["read:appointments"];
const WRITE = ["update:appointments"];

export const embeddedSignupRouter = Router();
embeddedSignupRouter.use(requireAuth);

embeddedSignupRouter.get("/status", requirePermissions({ every: READ }), asyncHandler(async (req, res) => {
  const docs = await WhatsAppConnectionModel.find({ salonId: req.context!.salonId, status: { $ne: "disconnected" } }).sort({ createdAt: -1 });
  ok(res, { configured: embeddedSignupConfigured(), connections: docs.map(safeConnection) });
}));

const startEmbeddedSignup = asyncHandler(async (req, res) => {
  if (!embeddedSignupConfigured()) throw ApiError.unavailableFeature("Meta Embedded Signup is not configured for this environment.");
  const state = await createEmbeddedSignupState({ salonId: req.context!.salonId, userId: req.context!.userId });
  const config = metaConfig();
  await audit(req, "whatsapp.embedded_signup.started", "whatsapp_connection");
  ok(res, { ...state, appId: config.appId, configId: config.configId, apiVersion: config.apiVersion, provider: "meta_production" }, 201);
});

embeddedSignupRouter.post("/embedded-signup/state", requirePermissions({ every: WRITE }), startEmbeddedSignup);
embeddedSignupRouter.post("/embedded-signup/start", requirePermissions({ every: WRITE }), startEmbeddedSignup);

const callbackSchema = z.object({
  state: z.string().min(20),
  authorizationCode: z.string().min(5),
  wabaId: z.string().min(1).optional(),
  phoneNumberId: z.string().min(1).optional(),
  businessId: z.string().optional(),
  redirectUri: z.string().url().optional()
});

embeddedSignupRouter.post("/embedded-signup/callback", requirePermissions({ every: WRITE }), asyncHandler(async (req, res) => {
  const body = callbackSchema.parse(req.body ?? {});
  await consumeEmbeddedSignupState(body.state, { salonId: req.context!.salonId, userId: req.context!.userId });

  const token = await exchangeEmbeddedSignupCode(body.authorizationCode, body.redirectUri);
  const wabaId = body.wabaId;
  if (!wabaId) throw ApiError.badRequest("Meta did not return a WhatsApp Business Account id. Complete Embedded Signup again.");
  const phoneNumbers = await fetchWabaPhoneNumbers(token.access_token, wabaId);
  const phone = body.phoneNumberId ? phoneNumbers.find((item) => item.id === body.phoneNumberId) : phoneNumbers[0];
  if (!phone?.id) throw ApiError.badRequest("No accessible WhatsApp phone number was returned by Meta for this WABA.");
  const webhookSubscribed = await subscribeWabaToWebhooks(token.access_token, wabaId);
  const doc = await upsertMetaConnection({
    salonId: req.context!.salonId,
    userId: req.context!.userId,
    provider: "meta_production",
    wabaId,
    businessId: body.businessId,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number || "",
    verifiedName: phone.verified_name || "",
    accessToken: token.access_token,
    tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    webhookSubscribed
  });
  await audit(req, "whatsapp.connected", "whatsapp_connection", String(doc._id), { phoneNumberId: doc.phoneNumberId, wabaId: doc.wabaId, webhookSubscribed });
  ok(res, { connection: safeConnection(doc) }, 201);
}));

embeddedSignupRouter.post("/disconnect", requirePermissions({ every: WRITE }), asyncHandler(async (req, res) => {
  const body = z.object({ phoneNumberId: z.string().optional() }).parse(req.body ?? {});
  const doc = await disconnectConnection(req.context!.salonId, body.phoneNumberId);
  await audit(req, "whatsapp.disconnected", "whatsapp_connection", String(doc._id), { phoneNumberId: doc.phoneNumberId });
  ok(res, { connection: safeConnection(doc) });
}));
