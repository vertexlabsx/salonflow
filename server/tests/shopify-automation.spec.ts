import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { WhatsAppTemplateModel } from "../src/models/whatsapp-template.model";
import { WhatsAppOutboundModel } from "../src/models/whatsapp-outbound.model";
import { ShopifyCustomerModel, ShopifyFlowExecutionModel, ShopifyFlowModel } from "../src/models/shopify-automation.model";
import { campaignPreview, importCustomers, runDueExecutions, verifyShopifyWebhook } from "../src/modules/shopify-automation/shopify-automation.service";

const SALON = "tenant_aura";

beforeAll(async () => {
  await createTestWorld({ SHOPIFY_API_SECRET: "shopify-test-secret" });
});

afterAll(async () => {
  await destroyTestWorld();
});

describe("Shopify Automation production contracts", () => {
  it("verifies Shopify webhook HMAC using the raw body", () => {
    const raw = JSON.stringify({ id: 123, topic: "orders/create" });
    const hmac = createHmac("sha256", "shopify-test-secret").update(raw, "utf8").digest("base64");
    expect(verifyShopifyWebhook(raw, hmac)).toBe(true);
    expect(verifyShopifyWebhook(raw, "invalid")).toBe(false);
  });

  it("normalizes and deduplicates imported customers without assuming consent", async () => {
    const result = await importCustomers(SALON, [
      { Name: "Garv", Phone: "98765 43210", Email: "garv@example.com" },
      { Name: "Garv Again", Phone: "+91 98765 43210", MarketingConsent: "true" },
      { Name: "Bad", Phone: "123" }
    ]);
    expect(result).toEqual({ imported: 2, invalid: 1 });
    expect(await ShopifyCustomerModel.countDocuments({ salonId: SALON })).toBe(1);
    const preview = await campaignPreview(SALON);
    expect(preview).toMatchObject({ audienceSize: 1, eligibleContacts: 1, excludedContacts: 0 });
  });

  it("executes a WhatsApp template node through existing outbound logging", async () => {
    await WhatsAppTemplateModel.create({ salonId: SALON, wabaId: "waba", metaTemplateId: "tpl", name: "order_confirmation", language: "en", category: "UTILITY", status: "APPROVED", components: [], lastSyncedAt: new Date() });
    const flow = await ShopifyFlowModel.create({ salonId: SALON, name: "Order Confirmation", description: "", trigger: "orders/create", status: "active", nodes: [{ id: "wa", type: "whatsapp_template", label: "Order Confirmation", config: { templateName: "order_confirmation", language: "en", variables: ["{{customer_name}}", "{{order_id}}"] }, next: "stop" }, { id: "stop", type: "stop", label: "Stop", config: {} }], metrics: { triggered: 0, completed: 0, messagesSent: 0, failed: 0, stopped: 0 } });
    await ShopifyFlowExecutionModel.create({ salonId: SALON, flowId: String(flow._id), eventId: new mongoose.Types.ObjectId().toString(), externalEventId: "evt-1", status: "queued", currentNodeId: "wa", context: { phone: "919876543210", customerName: "Garv", orderId: "#10452" }, scheduledAt: new Date(), nextRunAt: new Date(), retryCount: 0, isTest: false, error: "" });
    expect(await runDueExecutions(SALON)).toEqual({ attempted: 1 });
    const outbound = await WhatsAppOutboundModel.findOne({ salonId: SALON, toPhone: "919876543210" }).lean();
    expect(outbound?.status).toBe("sent");
    expect(outbound?.templatePayload).toMatchObject({ type: "template", template: { name: "order_confirmation", language: { code: "en" } } });
    expect(outbound?.metadata).toMatchObject({ source: "shopify_automation", flowId: String(flow._id), nodeId: "wa", isTest: false });
  });
});
