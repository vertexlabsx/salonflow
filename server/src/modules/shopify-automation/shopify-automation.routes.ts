import { Router } from "express";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { requireAuth } from "../../middleware/auth.middleware";
import { requirePermissions } from "../../middleware/rbac";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { addFlowNode, automationModels, campaignPreview, connectShopifyAndRegisterWebhooks, deleteFlowNode, importCustomers, ingestWebhook, markOptOut, normalizeShop, overview, runDueExecutions, seedReadyMadeFlows, sendCampaign, sendFlowTestMessage, shopifyInstallUrl, testShopifyConnection, updateFlowNode, validateFlowForActivation, verifyShopifyWebhook } from "./shopify-automation.service";

export const shopifyAutomationRouter = Router();
export const shopifyWebhookRouter = Router();
const STAFF_PERMISSION = "read:appointments";

shopifyAutomationRouter.get("/shopify/callback", asyncHandler(async (req, res) => {
  const query = z.object({ shop: z.string().min(1), code: z.string().min(1), state: z.string().min(1) }).parse(req.query);
  const state = JSON.parse(Buffer.from(query.state, "base64url").toString("utf8")) as { salonId?: string; userId?: string; ts?: number };
  if (!state.salonId || !state.userId || !state.ts || Date.now() - state.ts > 10 * 60_000) throw ApiError.forbidden("Invalid Shopify OAuth state.");
  await connectShopifyAndRegisterWebhooks(state.salonId, state.userId, query.shop, query.code);
  const frontendUrl = loadEnv().CORS_ORIGINS.split(",").map((origin) => origin.trim()).find((origin) => origin.includes("staff-app-kappa.vercel.app")) || "https://staff-app-kappa.vercel.app";
  res.redirect(`${frontendUrl}/shopify-admin/dashboard?shopify=connected`);
}));

shopifyAutomationRouter.use(requireAuth, requirePermissions(STAFF_PERMISSION));

shopifyAutomationRouter.get("/overview", asyncHandler(async (req, res) => ok(res, await overview(req.context!.salonId))));
shopifyAutomationRouter.get("/flows", asyncHandler(async (req, res) => ok(res, await automationModels.ShopifyFlowModel.find({ salonId: req.context!.salonId }).sort({ updatedAt: -1 }).lean())));
shopifyAutomationRouter.post("/flows/seed", asyncHandler(async (req, res) => ok(res, await seedReadyMadeFlows(req.context!.salonId, req.context!.userId), 201)));
shopifyAutomationRouter.post("/flows/:id/test-message", asyncHandler(async (req, res) => {
  const body = z.object({ nodeId: z.string().min(1), phone: z.string().min(10) }).parse(req.body);
  ok(res, await sendFlowTestMessage(req.context!.salonId, req.params.id, body.nodeId, body.phone));
}));
shopifyAutomationRouter.post("/flows", asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().min(1), description: z.string().default(""), trigger: z.string().min(1), status: z.enum(["draft", "active", "paused"]).default("draft"), nodes: z.array(z.any()).default([]) }).parse(req.body);
  ok(res, await automationModels.ShopifyFlowModel.create({ ...body, salonId: req.context!.salonId, createdBy: req.context!.userId, metrics: { triggered: 0, completed: 0, messagesSent: 0, failed: 0, stopped: 0 } }), 201);
}));
shopifyAutomationRouter.patch("/flows/:id", asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), trigger: z.string().optional(), status: z.enum(["draft", "active", "paused"]).optional(), nodes: z.array(z.any()).optional() }).parse(req.body);
  const existing = await automationModels.ShopifyFlowModel.findOne({ _id: req.params.id, salonId: req.context!.salonId });
  if (!existing) throw ApiError.notFound();
  const candidate = { ...existing.toObject(), ...body };
  if (body.status === "active") await validateFlowForActivation(req.context!.salonId, candidate);
  const flow = await automationModels.ShopifyFlowModel.findOneAndUpdate({ _id: req.params.id, salonId: req.context!.salonId }, { $set: { ...body, updatedBy: req.context!.userId } }, { new: true });
  if (!flow) throw ApiError.notFound();
  ok(res, flow);
}));
shopifyAutomationRouter.post("/flows/:id/nodes", asyncHandler(async (req, res) => {
  const body = z.object({ id: z.string().min(1), type: z.enum(["trigger", "wait", "condition", "whatsapp_template", "stop"]), label: z.string().min(1), config: z.record(z.unknown()).default({}), next: z.string().optional(), yes: z.string().optional(), no: z.string().optional() }).parse(req.body);
  ok(res, await addFlowNode(req.context!.salonId, req.params.id, body), 201);
}));
shopifyAutomationRouter.patch("/flows/:flowId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const body = z.object({ label: z.string().min(1).optional(), config: z.record(z.unknown()).optional(), next: z.string().optional(), yes: z.string().optional(), no: z.string().optional() }).parse(req.body);
  ok(res, await updateFlowNode(req.context!.salonId, req.params.flowId, req.params.nodeId, body));
}));
shopifyAutomationRouter.delete("/flows/:flowId/nodes/:nodeId", asyncHandler(async (req, res) => ok(res, await deleteFlowNode(req.context!.salonId, req.params.flowId, req.params.nodeId))));

shopifyAutomationRouter.post("/shopify/connect", asyncHandler(async (req, res) => {
  const body = z.object({ shop: z.string().min(1), code: z.string().min(1) }).parse(req.body);
  ok(res, await connectShopifyAndRegisterWebhooks(req.context!.salonId, req.context!.userId, body.shop, body.code), 201);
}));
shopifyAutomationRouter.post("/shopify/install-url", asyncHandler(async (req, res) => {
  const body = z.object({ shop: z.string().min(1) }).parse(req.body);
  const state = Buffer.from(JSON.stringify({ salonId: req.context!.salonId, userId: req.context!.userId, ts: Date.now() })).toString("base64url");
  ok(res, shopifyInstallUrl(body.shop, state));
}));
shopifyAutomationRouter.post("/shopify/disconnect", asyncHandler(async (req, res) => ok(res, await automationModels.ShopifyStoreModel.updateMany({ salonId: req.context!.salonId }, { $set: { status: "disconnected" } }))));
shopifyAutomationRouter.post("/shopify/test", asyncHandler(async (req, res) => ok(res, await testShopifyConnection(req.context!.salonId))));

shopifyAutomationRouter.get("/templates", asyncHandler(async (req, res) => ok(res, await automationModels.WhatsAppTemplateModel.find({ salonId: req.context!.salonId }).sort({ name: 1 }).lean())));
shopifyAutomationRouter.get("/logs", asyncHandler(async (req, res) => ok(res, await automationModels.WhatsAppOutboundModel.find({ salonId: req.context!.salonId }).sort({ createdAt: -1 }).limit(100).lean())));
shopifyAutomationRouter.get("/customers", asyncHandler(async (req, res) => ok(res, await automationModels.ShopifyCustomerModel.find({ salonId: req.context!.salonId }).sort({ updatedAt: -1 }).limit(200).lean())));
shopifyAutomationRouter.post("/customers/import", asyncHandler(async (req, res) => {
  const body = z.object({ rows: z.array(z.record(z.unknown())) }).parse(req.body);
  ok(res, await importCustomers(req.context!.salonId, body.rows), 201);
}));
shopifyAutomationRouter.post("/customers/opt-out", asyncHandler(async (req, res) => {
  const body = z.object({ phone: z.string().min(1) }).parse(req.body);
  ok(res, await markOptOut(req.context!.salonId, body.phone));
}));
shopifyAutomationRouter.get("/audiences", asyncHandler(async (req, res) => ok(res, await automationModels.ShopifyAudienceModel.find({ salonId: req.context!.salonId }).sort({ createdAt: -1 }).lean())));
shopifyAutomationRouter.post("/audiences", asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().min(1), description: z.string().default(""), conditions: z.record(z.unknown()).default({}), source: z.enum(["shopify", "import", "manual"]).default("shopify") }).parse(req.body);
  ok(res, await automationModels.ShopifyAudienceModel.create({ ...body, salonId: req.context!.salonId, createdBy: req.context!.userId }), 201);
}));
shopifyAutomationRouter.get("/campaigns/preview", asyncHandler(async (req, res) => ok(res, await campaignPreview(req.context!.salonId))));
shopifyAutomationRouter.get("/campaigns", asyncHandler(async (req, res) => ok(res, await automationModels.ShopifyCampaignModel.find({ salonId: req.context!.salonId }).sort({ createdAt: -1 }).lean())));
shopifyAutomationRouter.post("/campaigns", asyncHandler(async (req, res) => {
  const body = z.object({ name: z.string().min(1), audienceId: z.string().min(1), templateName: z.string().min(1), language: z.string().default("en"), scheduledAt: z.string().datetime().optional() }).parse(req.body);
  ok(res, await automationModels.ShopifyCampaignModel.create({ ...body, salonId: req.context!.salonId, createdBy: req.context!.userId, status: body.scheduledAt ? "scheduled" : "draft", scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }), 201);
}));
shopifyAutomationRouter.post("/campaigns/:id/send", asyncHandler(async (req, res) => ok(res, await sendCampaign(req.context!.salonId, req.params.id))));
shopifyAutomationRouter.post("/run-due", asyncHandler(async (req, res) => ok(res, await runDueExecutions(req.context!.salonId))));

shopifyWebhookRouter.post("/", asyncHandler(async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: string }).rawBody || JSON.stringify(req.body || {});
  if (!verifyShopifyWebhook(rawBody, req.header("x-shopify-hmac-sha256") || undefined)) throw ApiError.forbidden("Invalid Shopify webhook signature.");
  const shop = normalizeShop(String(req.header("x-shopify-shop-domain") || ""));
  const topic = String(req.header("x-shopify-topic") || "");
  const webhookId = String(req.header("x-shopify-webhook-id") || `${topic}:${Date.now()}`);
  ok(res, await ingestWebhook(shop, topic, webhookId, req.body as Record<string, unknown>), 202);
}));
