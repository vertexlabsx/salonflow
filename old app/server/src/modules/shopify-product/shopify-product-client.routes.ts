import { Router } from "express";
import { asyncHandler, ok } from "../../shared/http";
import { requireShopifyAuth, requireShopifyClient } from "./shopify-product-auth";
import { automationModels } from "../shopify-automation/shopify-automation.service";

export const shopifyProductClientRouter = Router();

shopifyProductClientRouter.use(requireShopifyAuth, requireShopifyClient);

shopifyProductClientRouter.get("/overview", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const [store, flows, sentToday, delivered, failed] = await Promise.all([
    automationModels.ShopifyStoreModel.findOne({ salonId }).sort({ connectedAt: -1 }).lean(),
    automationModels.ShopifyFlowModel.find({ salonId }).sort({ updatedAt: -1 }).lean(),
    automationModels.WhatsAppOutboundModel.countDocuments({ salonId, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    automationModels.WhatsAppOutboundModel.countDocuments({ salonId, status: "delivered" }),
    automationModels.WhatsAppOutboundModel.countDocuments({ salonId, status: "failed" })
  ]);
  const activeFlows = flows.filter((f) => f.status === "active").length;
  ok(res, {
    store: store ? { shop: store.shop, storeName: store.storeName, status: store.status } : null,
    stats: { activeFlows, totalFlows: flows.length, sentToday, delivered, failed }
  });
}));

shopifyProductClientRouter.get("/flows", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const flows = await automationModels.ShopifyFlowModel.find({ salonId }).sort({ updatedAt: -1 }).lean();
  ok(res, flows.map((f) => ({
    name: f.name,
    description: f.description,
    trigger: f.trigger,
    status: f.status,
    metrics: f.metrics
  })));
}));

shopifyProductClientRouter.get("/activity", asyncHandler(async (req, res) => {
  const salonId = req.shopifyContext!.shopDomain;
  const logs = await automationModels.WhatsAppOutboundModel.find({ salonId }).sort({ createdAt: -1 }).limit(20).lean();
  ok(res, logs.map((log) => ({
    phone: log.toPhone ? `${log.toPhone.slice(0, 4)}****${log.toPhone.slice(-3)}` : "",
    status: log.status,
    time: log.createdAt
  })));
}));
