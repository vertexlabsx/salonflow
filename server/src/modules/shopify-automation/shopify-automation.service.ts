import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../../config/env";
import { WhatsAppOutboundModel } from "../../models/whatsapp-outbound.model";
import { WhatsAppTemplateModel } from "../../models/whatsapp-template.model";
import { CustomerModel } from "../../models/customer.model";
import { ApiError } from "../../shared/http";
import { encryptSecret, decryptSecret } from "../../shared/secret-box";
import { logger } from "../../shared/logger";
import { sendWhatsAppTemplateMessage } from "../whatsapp/whatsapp.service";
import { ShopifyAudienceModel, ShopifyCampaignModel, ShopifyCustomerModel, ShopifyEventModel, ShopifyFlowExecutionModel, ShopifyFlowModel, ShopifyStoreModel, type ShopifyFlow, type FlowNodeKind } from "../../models/shopify-automation.model";

const TOPICS = ["orders/create", "orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"];
const MAX_EXECUTION_RETRIES = 3;

export function normalizeShop(value: string): string {
  const shop = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw ApiError.badRequest("Enter a valid myshopify.com store URL.");
  return shop;
}

export function verifyShopifyWebhook(rawBody: string, hmacHeader?: string): boolean {
  const secret = loadEnv().SHOPIFY_API_SECRET;
  if (!secret) return loadEnv().NODE_ENV !== "production";
  if (!hmacHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(hmacHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readyMadeFlows(): Array<Pick<ShopifyFlow, "name" | "description" | "trigger" | "nodes" | "status">> {
  return [
    { name: "Abandoned Cart", description: "Three-step abandoned checkout recovery with purchase checks.", trigger: "checkouts/create", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Checkout Abandoned", config: {}, next: "wait-30" }, { id: "wait-30", type: "wait", label: "Wait 30 minutes", config: { minutes: 30 }, next: "wa-1" }, { id: "wa-1", type: "whatsapp_template", label: "Abandoned Cart #1", config: { templateName: "abandoned_cart_1" }, next: "wait-6h" }, { id: "wait-6h", type: "wait", label: "Wait 6 hours", config: { minutes: 360 }, next: "order-exists-1" }, { id: "order-exists-1", type: "condition", label: "Order exists?", config: { field: "orderExists", operator: "equals", value: true }, yes: "stop", no: "wa-2" }, { id: "wa-2", type: "whatsapp_template", label: "Abandoned Cart #2", config: { templateName: "abandoned_cart_2" }, next: "wait-18h" }, { id: "wait-18h", type: "wait", label: "Wait 18 hours", config: { minutes: 1080 }, next: "order-exists-2" }, { id: "order-exists-2", type: "condition", label: "Order exists?", config: { field: "orderExists", operator: "equals", value: true }, yes: "stop", no: "wa-3" }, { id: "wa-3", type: "whatsapp_template", label: "Abandoned Cart #3", config: { templateName: "abandoned_cart_3" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Order Confirmation", description: "Send order details when an order is created.", trigger: "orders/create", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Order Created", config: {}, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Order Confirmation", config: { templateName: "order_confirmation" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Payment Confirmation", description: "Confirm paid Shopify orders.", trigger: "orders/paid", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Order Paid", config: {}, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Payment Confirmation", config: { templateName: "payment_confirmation" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "COD Confirmation", description: "Branch only for cash-on-delivery orders.", trigger: "orders/create", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Order Created", config: {}, next: "cod" }, { id: "cod", type: "condition", label: "Payment method is COD", config: { field: "paymentMethod", operator: "contains", value: "cod" }, yes: "wa", no: "stop" }, { id: "wa", type: "whatsapp_template", label: "COD Confirmation", config: { templateName: "cod_confirmation" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Order Shipped", description: "Send tracking details when fulfilled.", trigger: "orders/fulfilled", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Order Fulfilled", config: {}, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Shipping Template", config: { templateName: "order_shipped" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Delivery Follow-up", description: "Draft only; activate after reliable delivered events exist.", trigger: "orders/fulfilled", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Delivered", config: {}, next: "wait" }, { id: "wait", type: "wait", label: "Wait 3 days", config: { minutes: 4320 }, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Delivery Follow-up", config: { templateName: "delivery_followup" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Review Request", description: "Ask for a review after post-delivery delay.", trigger: "orders/fulfilled", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Fulfilled", config: {}, next: "wait" }, { id: "wait", type: "wait", label: "Wait 3 days", config: { minutes: 4320 }, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Review Request", config: { templateName: "review_request" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] },
    { name: "Reorder Reminder", description: "Reminder template for repeat purchase audiences.", trigger: "manual/reorder", status: "draft", nodes: [{ id: "trigger", type: "trigger", label: "Manual Audience", config: {}, next: "wa" }, { id: "wa", type: "whatsapp_template", label: "Reorder Reminder", config: { templateName: "reorder_reminder" }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }] }
  ];
}

export async function validateFlowForActivation(salonId: string, flow: Pick<ShopifyFlow, "nodes" | "trigger">): Promise<void> {
  if (!flow.trigger) throw ApiError.badRequest("Flow trigger is required.");
  if (!Array.isArray(flow.nodes) || !flow.nodes.length) throw ApiError.badRequest("Flow must contain nodes.");
  const ids = new Set(flow.nodes.map((node) => node.id));
  if (flow.nodes[0]!.type !== "trigger") throw ApiError.badRequest("Flow must start with a trigger node.");
  for (const node of flow.nodes) {
    for (const next of [node.next, node.yes, node.no].filter(Boolean)) if (!ids.has(next!)) throw ApiError.badRequest(`Node ${node.label} points to a missing node.`);
    if (node.type === "wait" && Number(node.config.minutes || 0) <= 0) throw ApiError.badRequest(`Wait node ${node.label} needs a positive delay.`);
    if (node.type === "whatsapp_template") {
      const templateName = String(node.config.templateName || "");
      const language = String(node.config.language || "en");
      await resolveApprovedTemplate(salonId, templateName, language);
    }
  }
}

export function shopifyInstallUrl(shopInput: string, state: string) {
  const env = loadEnv();
  if (!env.SHOPIFY_API_KEY) throw ApiError.unavailableFeature("Shopify app credentials are not configured.");
  const shop = normalizeShop(shopInput);
  const appUrl = (env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/v1/shopify-automation/shopify/callback`;
  const params = new URLSearchParams({ client_id: env.SHOPIFY_API_KEY, scope: env.SHOPIFY_SCOPES, redirect_uri: redirectUri, state });
  return { shop, installUrl: `https://${shop}/admin/oauth/authorize?${params.toString()}` };
}

export async function overview(salonId: string) {
  const [store, flows, sentToday, delivered, read, failed, recentEvents] = await Promise.all([
    ShopifyStoreModel.findOne({ salonId }).sort({ connectedAt: -1 }).lean(),
    ShopifyFlowModel.find({ salonId }).sort({ updatedAt: -1 }).lean(),
    WhatsAppOutboundModel.countDocuments({ salonId, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    WhatsAppOutboundModel.countDocuments({ salonId, status: "delivered" }),
    WhatsAppOutboundModel.countDocuments({ salonId, status: "read" }),
    WhatsAppOutboundModel.countDocuments({ salonId, status: "failed" }),
    ShopifyEventModel.find({ salonId }).sort({ createdAt: -1 }).limit(8).lean()
  ]);
  return { store: store ? { shop: store.shop, storeName: store.storeName, status: store.status, lastSyncAt: store.lastSyncAt, connectedAt: store.connectedAt } : null, whatsapp: { status: "uses SalonFlow WhatsApp", sentToday, delivered, read, failed }, metrics: { activeFlows: flows.filter((f) => f.status === "active").length, abandonedCarts: recentEvents.filter((e) => e.topic.startsWith("checkouts/")).length, recoveredCarts: 0, ordersProcessed: recentEvents.filter((e) => e.topic.startsWith("orders/")).length, marketingMessagesSent: sentToday }, recentActivity: recentEvents.map((e) => ({ time: e.createdAt, title: e.topic, detail: `Shopify event ${e.externalEventId}` })) };
}

export async function exchangeShopifyCode(salonId: string, userId: string, shopInput: string, code: string) {
  const env = loadEnv();
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) throw ApiError.unavailableFeature("Shopify app credentials are not configured.");
  const shop = normalizeShop(shopInput);
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code }) });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; scope?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw ApiError.badRequest(payload.error_description || "Shopify authorization failed.");
  const store = await ShopifyStoreModel.findOneAndUpdate({ salonId, shop }, { $set: { encryptedAccessToken: encryptSecret(payload.access_token), scopes: String(payload.scope || env.SHOPIFY_SCOPES).split(","), status: "connected", connectedAt: new Date(), createdBy: userId, storeName: shop } }, { upsert: true, new: true });
  return { shop: store.shop, status: store.status, connectedAt: store.connectedAt };
}

export async function testShopifyConnection(salonId: string) {
  const store = await ShopifyStoreModel.findOne({ salonId, status: "connected" }).select("+encryptedAccessToken");
  if (!store) throw ApiError.notFound("No connected Shopify store.");
  const response = await fetch(`https://${store.shop}/admin/api/2025-07/shop.json`, { headers: { "X-Shopify-Access-Token": decryptSecret(store.encryptedAccessToken) } });
  if (!response.ok) throw ApiError.badRequest(`Shopify test failed (${response.status}).`);
  const payload = await response.json().catch(() => ({})) as { shop?: { name?: string; myshopify_domain?: string } };
  store.storeName = payload.shop?.name || store.storeName;
  store.lastSyncAt = new Date();
  await store.save();
  return { shop: store.shop, storeName: store.storeName, status: store.status, lastSyncAt: store.lastSyncAt };
}

export async function ingestWebhook(shop: string, topic: string, webhookId: string, payload: Record<string, unknown>) {
  if (!TOPICS.includes(topic)) return { ignored: true };
  const store = await ShopifyStoreModel.findOne({ shop, status: "connected" }).lean();
  if (!store) return { ignored: true };
  const event = await ShopifyEventModel.findOneAndUpdate({ shop, topic, externalEventId: webhookId }, { $setOnInsert: { salonId: store.salonId, shop, topic, externalEventId: webhookId, payload } }, { upsert: true, new: true, includeResultMetadata: true });
  const eventDoc = event.value;
  if (!eventDoc) return { ignored: true };
  const inserted = !event.lastErrorObject?.updatedExisting;
  if (!inserted) return { accepted: true, duplicate: true, flows: 0 };
  const flows = await ShopifyFlowModel.find({ salonId: store.salonId, trigger: topic, status: "active" });
  for (const flow of flows) {
    await ShopifyFlowExecutionModel.updateOne({ salonId: store.salonId, flowId: String(flow._id), externalEventId: webhookId }, { $setOnInsert: { eventId: String(eventDoc._id), status: "queued", currentNodeId: flow.nodes[0]?.id || "", context: normalizeContext(payload, store.storeName || store.shop), scheduledAt: new Date(), nextRunAt: new Date(), retryCount: 0, isTest: false, error: "" } }, { upsert: true });
    flow.metrics.triggered += 1;
    await flow.save();
  }
  setImmediate(() => runDueExecutions(store.salonId).catch((error) => logger.error("Shopify automation run failed", { error: error instanceof Error ? error.message : String(error) })));
  return { accepted: true, flows: flows.length };
}

function normalizeContext(payload: Record<string, unknown>, shopName = ""): Record<string, unknown> {
  const p = payload as any;
  const customer = p.customer || p.billing_address || p.shipping_address || {};
  const phone = normalizePhone(String(customer.phone || p.phone || p.shipping_address?.phone || p.billing_address?.phone || ""));
  const lineItem = Array.isArray(p.line_items) ? p.line_items[0] : null;
  return { shopName, customerName: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || p.email || phone, phone, email: customer.email || p.email || "", customerId: String(customer.id || p.customer_id || ""), orderId: String(p.name || p.order_number || p.id || ""), orderTotal: String(p.total_price || p.current_total_price || p.total_price_set?.shop_money?.amount || ""), paymentMethod: String((p.payment_gateway_names || p.gateway || []).toString()).toLowerCase(), checkoutId: String(p.checkout_id || p.id || p.token || ""), checkoutUrl: p.abandoned_checkout_url || p.web_url || p.checkout_url || "", trackingUrl: p.fulfillments?.[0]?.tracking_url || "", productName: lineItem?.name || lineItem?.title || "", orderExists: false };
}

const VARIABLE_ALIASES: Record<string, string> = { customer_name: "customerName", order_id: "orderId", order_total: "orderTotal", checkout_url: "checkoutUrl", tracking_url: "trackingUrl", product_name: "productName", shop_name: "shopName", payment_method: "paymentMethod" };

function resolveVariable(name: string, context: Record<string, unknown>): string {
  const key = VARIABLE_ALIASES[name] || name;
  const value = context[key];
  if (value === undefined || value === null || value === "") throw new Error(`Missing template variable: ${name}`);
  return String(value);
}

function resolveVariables(values: unknown, context: Record<string, unknown>): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((item) => {
    const raw = String(item);
    const match = raw.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);
    return match ? resolveVariable(match[1]!, context) : raw.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_all, key) => resolveVariable(key, context));
  });
}

async function resolveApprovedTemplate(salonId: string, templateName: string, language: string) {
  const template = await WhatsAppTemplateModel.findOne({ salonId, name: templateName, language, status: /approved/i }).lean();
  if (!template) throw new Error(`Approved WhatsApp template unavailable: ${templateName} (${language})`);
  return template;
}

async function refreshOrderExists(execution: { salonId: string; context: Record<string, unknown> }) {
  const checkoutId = String(execution.context.checkoutId || "");
  const email = String(execution.context.email || "");
  const phone = String(execution.context.phone || "");
  if (!checkoutId && !email && !phone) return false;
  const order = await ShopifyEventModel.findOne({ salonId: execution.salonId, topic: { $in: ["orders/create", "orders/paid"] }, $or: [{ "payload.checkout_id": checkoutId }, { "payload.email": email }, { "payload.customer.phone": phone }, { "payload.billing_address.phone": phone }, { "payload.shipping_address.phone": phone }] }).lean();
  execution.context.orderExists = Boolean(order);
  return Boolean(order);
}

function evaluate(config: Record<string, unknown>, context: Record<string, unknown>): boolean {
  const actual = context[String(config.field)] ?? "";
  const expected = config.value;
  if (config.operator === "equals") return actual === expected;
  if (config.operator === "gt") return Number(actual) > Number(expected);
  if (config.operator === "contains") return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  return false;
}

function renderTemplateFallback(templateName: string, context: Record<string, unknown>): string {
  return `Template ${templateName}: ${context.customerName || "Customer"} ${context.orderId ? `Order ${context.orderId}` : ""} ${context.checkoutUrl || context.trackingUrl || ""}`.trim();
}

export async function runDueExecutions(salonId?: string) {
  const now = new Date();
  const staleLock = new Date(Date.now() - 10 * 60_000);
  const filter = { status: { $in: ["queued", "waiting", "failed"] }, retryCount: { $lte: MAX_EXECUTION_RETRIES }, $and: [{ nextRunAt: { $lte: now } }, { $or: [{ lockedAt: null }, { lockedAt: { $lte: staleLock } }] }] } as any;
  if (salonId) filter.salonId = salonId;
  let attempted = 0;
  for (let i = 0; i < 50; i += 1) {
    const execution = await ShopifyFlowExecutionModel.findOneAndUpdate(filter, { $set: { status: "running", lockedAt: now } }, { sort: { nextRunAt: 1, scheduledAt: 1 }, new: true });
    if (!execution) break;
    attempted += 1;
    const flow = await ShopifyFlowModel.findOne({ _id: execution.flowId, salonId: execution.salonId });
    if (!flow || flow.status !== "active") continue;
    const node = flow.nodes.find((item) => item.id === execution.currentNodeId) || flow.nodes[0];
    if (!node) continue;
    try {
      execution.status = "running";
      if (node.type === "wait") {
        execution.status = "waiting";
        execution.currentNodeId = node.next || "";
        execution.nextRunAt = new Date(Date.now() + Number(node.config.minutes || 0) * 60_000);
      } else if (node.type === "condition") {
        if (node.config.field === "orderExists") await refreshOrderExists(execution);
        execution.currentNodeId = (evaluate(node.config, execution.context) ? node.yes : node.no) || "";
        execution.status = "queued";
        execution.nextRunAt = new Date();
      } else if (node.type === "whatsapp_template") {
        const phone = String(execution.context.phone || "");
        if (!phone) throw new Error("No customer phone number in Shopify event.");
        const templateName = String(node.config.templateName || "");
        const language = String(node.config.language || "en");
        const template = await resolveApprovedTemplate(execution.salonId, templateName, language);
        const row = await sendWhatsAppTemplateMessage({ salonId: execution.salonId, toPhone: phone, templateName, language, category: template.category, bodyParameters: resolveVariables(node.config.variables || node.config.bodyVariables, execution.context), headerParameters: resolveVariables(node.config.headerVariables, execution.context), metadata: { source: "shopify_automation", flowId: execution.flowId, executionId: String(execution._id), nodeId: node.id, templateName, shopifyOrderId: execution.context.orderId, shopifyCheckoutId: execution.context.checkoutId, isTest: execution.isTest, dedupeKey: `${execution.flowId}:${execution.externalEventId}:${node.id}` } });
        if (row.status === "failed") throw new Error(row.error || "WhatsApp template send failed.");
        if (!execution.isTest) flow.metrics.messagesSent += 1;
        execution.currentNodeId = node.next || "";
        execution.status = "queued";
        execution.nextRunAt = new Date();
      } else if (node.type === "stop" || !execution.currentNodeId) {
        execution.status = "completed";
        if (!execution.isTest) flow.metrics.completed += 1;
      } else {
        execution.currentNodeId = node.next || "";
        execution.status = "queued";
        execution.nextRunAt = new Date();
      }
      execution.lockedAt = null;
      await execution.save();
      await flow.save();
    } catch (error) {
      execution.retryCount += 1;
      execution.status = execution.retryCount <= MAX_EXECUTION_RETRIES ? "waiting" : "failed";
      execution.nextRunAt = new Date(Date.now() + Math.min(execution.retryCount, 5) * 60_000);
      execution.lockedAt = null;
      execution.error = error instanceof Error ? error.message : String(error);
      if (!execution.isTest && execution.status === "failed") flow.metrics.failed += 1;
      await execution.save();
      await flow.save();
    }
  }
  return { attempted };
}

export async function sendFlowTestMessage(salonId: string, flowId: string, nodeId: string, phoneInput: string) {
  const flow = await ShopifyFlowModel.findOne({ _id: flowId, salonId }).lean();
  if (!flow) throw ApiError.notFound("Flow not found.");
  const node = flow.nodes.find((item) => item.id === nodeId && item.type === "whatsapp_template");
  if (!node) throw ApiError.badRequest("Select a WhatsApp template node.");
  const context = { shopName: "Test Shop", customerName: "Test Customer", phone: normalizePhone(phoneInput), orderId: "TEST-123", orderTotal: "999", checkoutUrl: "https://example.com/test-checkout", trackingUrl: "https://example.com/test-tracking", productName: "Test Product", paymentMethod: "prepaid", checkoutId: "TEST-CHECKOUT" };
  const templateName = String(node.config.templateName || "");
  const language = String(node.config.language || "en");
  const template = await resolveApprovedTemplate(salonId, templateName, language);
  const row = await sendWhatsAppTemplateMessage({ salonId, toPhone: context.phone, templateName, language, category: template.category, bodyParameters: resolveVariables(node.config.variables || node.config.bodyVariables, context), headerParameters: resolveVariables(node.config.headerVariables, context), metadata: { source: "shopify_automation_test", flowId, nodeId, templateName, isTest: true, dedupeKey: `test:${flowId}:${nodeId}:${context.phone}:${Date.now()}` } });
  return { status: row.status, providerMessageId: row.providerMessageId, error: row.error };
}

export async function seedReadyMadeFlows(salonId: string, userId: string) {
  for (const flow of readyMadeFlows()) {
    await ShopifyFlowModel.updateOne({ salonId, name: flow.name }, { $setOnInsert: { ...flow, metrics: { triggered: 0, completed: 0, messagesSent: 0, failed: 0, stopped: 0 }, createdBy: userId } }, { upsert: true });
  }
  return ShopifyFlowModel.find({ salonId }).sort({ createdAt: 1 }).lean();
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

export async function importCustomers(salonId: string, rows: Array<Record<string, unknown>>) {
  let imported = 0;
  let invalid = 0;
  for (const row of rows.slice(0, 2000)) {
    const phone = String(row.Phone || row.phone || "");
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10) { invalid += 1; continue; }
    await ShopifyCustomerModel.updateOne({ salonId, normalizedPhone }, { $set: { name: String(row.Name || row.name || ""), phone, normalizedPhone, email: String(row.Email || row.email || ""), orderCount: Number(row.OrderCount || row.orderCount || 0), totalSpend: Number(row.TotalSpend || row.totalSpend || 0), tags: String(row.Tags || row.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean), marketingConsent: String(row.MarketingConsent || row.marketingConsent || "").toLowerCase() === "true", source: "import" } }, { upsert: true });
    imported += 1;
  }
  return { imported, invalid };
}

export async function campaignPreview(salonId: string) {
  const total = await ShopifyCustomerModel.countDocuments({ salonId });
  const eligible = await ShopifyCustomerModel.countDocuments({ salonId, marketingConsent: true, marketingOptOut: false });
  return { audienceSize: total, eligibleContacts: eligible, excludedContacts: total - eligible, estimatedMessages: eligible };
}

export async function sendCampaign(salonId: string, campaignId: string) {
  const campaign = await ShopifyCampaignModel.findOne({ _id: campaignId, salonId });
  if (!campaign) throw ApiError.notFound("Campaign not found.");
  const template = await resolveApprovedTemplate(salonId, campaign.templateName, campaign.language);
  const customers = await ShopifyCustomerModel.find({ salonId, marketingConsent: true, marketingOptOut: false, normalizedPhone: { $ne: "" } }).limit(500);
  campaign.status = "running";
  campaign.confirmedAt = new Date();
  await campaign.save();
  for (const customer of customers) {
    const row = await sendWhatsAppTemplateMessage({ salonId, toPhone: customer.normalizedPhone, templateName: campaign.templateName, language: campaign.language, category: template.category || "MARKETING", bodyParameters: [customer.name || "Customer"], metadata: { source: "shopify_campaign", campaignId: String(campaign._id), customerId: customer.shopifyCustomerId, isTest: false, dedupeKey: `campaign:${campaign._id}:${customer.normalizedPhone}` } });
    if (row.status === "failed") campaign.failedCount += 1;
    else campaign.sentCount += 1;
  }
  campaign.status = "completed";
  await campaign.save();
  return campaign;
}

export async function markOptOut(salonId: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);
  await Promise.all([ShopifyCustomerModel.updateOne({ salonId, normalizedPhone }, { $set: { marketingOptOut: true } }), CustomerModel.updateOne({ salonId, normalizedPhone }, { $set: { marketingOptOut: true } })]);
  return { marketingOptOut: true };
}

export async function addFlowNode(salonId: string, flowId: string, node: { id: string; type: FlowNodeKind; label: string; config?: Record<string, unknown>; next?: string; yes?: string; no?: string }) {
  const flow = await ShopifyFlowModel.findOne({ _id: flowId, salonId });
  if (!flow) throw ApiError.notFound("Flow not found.");
  if (flow.nodes.some((n) => n.id === node.id)) throw ApiError.badRequest(`Node id "${node.id}" already exists in this flow.`);
  flow.nodes.push({ ...node, config: node.config || {} });
  await flow.save();
  return flow;
}

export async function updateFlowNode(salonId: string, flowId: string, nodeId: string, patch: { label?: string; config?: Record<string, unknown>; next?: string; yes?: string; no?: string }) {
  const flow = await ShopifyFlowModel.findOne({ _id: flowId, salonId });
  if (!flow) throw ApiError.notFound("Flow not found.");
  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node) throw ApiError.notFound(`Node "${nodeId}" not found in this flow.`);
  if (patch.label !== undefined) node.label = patch.label;
  if (patch.config !== undefined) node.config = patch.config;
  if (patch.next !== undefined) node.next = patch.next;
  if (patch.yes !== undefined) node.yes = patch.yes;
  if (patch.no !== undefined) node.no = patch.no;
  await flow.save();
  return flow;
}

export async function deleteFlowNode(salonId: string, flowId: string, nodeId: string) {
  const flow = await ShopifyFlowModel.findOne({ _id: flowId, salonId });
  if (!flow) throw ApiError.notFound("Flow not found.");
  const nodeIndex = flow.nodes.findIndex((n) => n.id === nodeId);
  if (nodeIndex === -1) throw ApiError.notFound(`Node "${nodeId}" not found in this flow.`);
  if (flow.nodes[nodeIndex]!.type === "trigger") throw ApiError.badRequest("Cannot delete the trigger node.");
  for (const n of flow.nodes) {
    if (n.next === nodeId) n.next = undefined;
    if (n.yes === nodeId) n.yes = undefined;
    if (n.no === nodeId) n.no = undefined;
  }
  flow.nodes.splice(nodeIndex, 1);
  await flow.save();
  return flow;
}

export const automationModels = { ShopifyFlowModel, ShopifyAudienceModel, ShopifyCampaignModel, ShopifyCustomerModel, WhatsAppOutboundModel, WhatsAppTemplateModel, ShopifyStoreModel };
