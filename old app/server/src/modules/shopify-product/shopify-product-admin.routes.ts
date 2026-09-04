import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler, ok } from "../../shared/http";
import { requireShopifyAuth, requireShopifyAdmin } from "./shopify-product-auth";
import { addFlowNode, automationModels, campaignPreview, deleteFlowNode, exchangeShopifyCode, importCustomers, markOptOut, overview, runDueExecutions, seedReadyMadeFlows, sendCampaign, sendFlowTestMessage, shopifyInstallUrl, testShopifyConnection, updateFlowNode, validateFlowForActivation } from "../shopify-automation/shopify-automation.service";

export const shopifyProductAdminRouter = Router();

shopifyProductAdminRouter.use(requireShopifyAuth, requireShopifyAdmin);

shopifyProductAdminRouter.get("/overview", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await overview(salonId));
}));

shopifyProductAdminRouter.get("/flows", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.ShopifyFlowModel.find({ salonId }).sort({ updatedAt: -1 }).lean());
}));

shopifyProductAdminRouter.post("/flows/seed", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await seedReadyMadeFlows(salonId, req.shopifyContext!.userId), 201);
}));

shopifyProductAdminRouter.post("/flows", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ name: z.string().min(1), description: z.string().default(""), trigger: z.string().min(1), status: z.enum(["draft", "active", "paused"]).default("draft"), nodes: z.array(z.any()).default([]) }).parse(req.body);
  ok(res, await automationModels.ShopifyFlowModel.create({ ...body, salonId, createdBy: req.shopifyContext!.userId, metrics: { triggered: 0, completed: 0, messagesSent: 0, failed: 0, stopped: 0 } }), 201);
}));

shopifyProductAdminRouter.patch("/flows/:id", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), trigger: z.string().optional(), status: z.enum(["draft", "active", "paused"]).optional(), nodes: z.array(z.any()).optional() }).parse(req.body);
  const existing = await automationModels.ShopifyFlowModel.findOne({ _id: req.params.id, salonId });
  if (!existing) throw ApiError.notFound();
  const candidate = { ...existing.toObject(), ...body };
  if (body.status === "active") await validateFlowForActivation(salonId, candidate);
  const flow = await automationModels.ShopifyFlowModel.findOneAndUpdate({ _id: req.params.id, salonId }, { $set: { ...body, updatedBy: req.shopifyContext!.userId } }, { new: true });
  if (!flow) throw ApiError.notFound();
  ok(res, flow);
}));

shopifyProductAdminRouter.post("/flows/:id/test-message", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ nodeId: z.string().min(1), phone: z.string().min(10) }).parse(req.body);
  ok(res, await sendFlowTestMessage(salonId, req.params.id, body.nodeId, body.phone));
}));

shopifyProductAdminRouter.post("/flows/:id/nodes", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ id: z.string().min(1), type: z.enum(["trigger", "wait", "condition", "whatsapp_template", "stop"]), label: z.string().min(1), config: z.record(z.unknown()).default({}), next: z.string().optional(), yes: z.string().optional(), no: z.string().optional() }).parse(req.body);
  ok(res, await addFlowNode(salonId, req.params.id, body), 201);
}));

shopifyProductAdminRouter.patch("/flows/:flowId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ label: z.string().min(1).optional(), config: z.record(z.unknown()).optional(), next: z.string().optional(), yes: z.string().optional(), no: z.string().optional() }).parse(req.body);
  ok(res, await updateFlowNode(salonId, req.params.flowId, req.params.nodeId, body));
}));

shopifyProductAdminRouter.delete("/flows/:flowId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await deleteFlowNode(salonId, req.params.flowId, req.params.nodeId));
}));

shopifyProductAdminRouter.get("/templates", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.WhatsAppTemplateModel.find({ salonId }).sort({ name: 1 }).lean());
}));

shopifyProductAdminRouter.get("/logs", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.WhatsAppOutboundModel.find({ salonId }).sort({ createdAt: -1 }).limit(100).lean());
}));

shopifyProductAdminRouter.get("/customers", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.ShopifyCustomerModel.find({ salonId }).sort({ updatedAt: -1 }).limit(200).lean());
}));

shopifyProductAdminRouter.post("/customers/import", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ rows: z.array(z.record(z.unknown())) }).parse(req.body);
  ok(res, await importCustomers(salonId, body.rows), 201);
}));

shopifyProductAdminRouter.post("/customers/opt-out", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ phone: z.string().min(1) }).parse(req.body);
  ok(res, await markOptOut(salonId, body.phone));
}));

shopifyProductAdminRouter.get("/campaigns/preview", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await campaignPreview(salonId));
}));

shopifyProductAdminRouter.get("/campaigns", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.ShopifyCampaignModel.find({ salonId }).sort({ createdAt: -1 }).lean());
}));

shopifyProductAdminRouter.post("/campaigns", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ name: z.string().min(1), audienceId: z.string().min(1), templateName: z.string().min(1), language: z.string().default("en"), scheduledAt: z.string().datetime().optional() }).parse(req.body);
  ok(res, await automationModels.ShopifyCampaignModel.create({ ...body, salonId, createdBy: req.shopifyContext!.userId, status: body.scheduledAt ? "scheduled" : "draft", scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }), 201);
}));

shopifyProductAdminRouter.post("/campaigns/:id/send", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await sendCampaign(salonId, req.params.id));
}));

shopifyProductAdminRouter.post("/shopify/connect", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ shop: z.string().min(1), code: z.string().min(1) }).parse(req.body);
  ok(res, await exchangeShopifyCode(salonId, req.shopifyContext!.userId, body.shop, body.code), 201);
}));

shopifyProductAdminRouter.post("/shopify/install-url", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const body = z.object({ shop: z.string().min(1) }).parse(req.body);
  const state = Buffer.from(JSON.stringify({ salonId, userId: req.shopifyContext!.userId, ts: Date.now() })).toString("base64url");
  ok(res, shopifyInstallUrl(body.shop, state));
}));

shopifyProductAdminRouter.post("/shopify/test", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await testShopifyConnection(salonId));
}));

shopifyProductAdminRouter.post("/shopify/disconnect", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await automationModels.ShopifyStoreModel.updateMany({ salonId }, { $set: { status: "disconnected" } }));
}));

shopifyProductAdminRouter.post("/run-due", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  ok(res, await runDueExecutions(salonId));
}));
