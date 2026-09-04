import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { WhatsAppTemplateModel } from "../src/models/whatsapp-template.model";
import { WhatsAppOutboundModel } from "../src/models/whatsapp-outbound.model";
import { ShopifyCustomerModel, ShopifyFlowExecutionModel, ShopifyFlowModel, ShopifyStoreModel } from "../src/models/shopify-automation.model";
import { campaignPreview, importCustomers, registerWebhooks, connectShopifyAndRegisterWebhooks, runDueExecutions, SHOPIFY_API_VERSION, verifyShopifyWebhook } from "../src/modules/shopify-automation/shopify-automation.service";
import { encryptSecret } from "../src/shared/secret-box";

const SALON = "tenant_aura";

beforeAll(async () => {
  await createTestWorld({
    SHOPIFY_API_SECRET: "shopify-test-secret",
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_APP_URL: "https://salonflow-0o9u.onrender.com"
  });
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

describe("SHOPIFY_API_VERSION single source of truth", () => {
  it("exports a valid Shopify API version string", () => {
    expect(SHOPIFY_API_VERSION).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("Webhook registration", () => {
  const SHOP = "test-store.myshopify.com";
  const TOKEN = "test-access-token";
  const WEBHOOK_URI = "https://salonflow-0o9u.onrender.com/shopify/webhooks";
  let ENCRYPTED_TOKEN: string;

  beforeEach(() => {
    ENCRYPTED_TOKEN = encryptSecret(TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers all 5 missing webhooks when none exist", async () => {
    await ShopifyStoreModel.create({ salonId: SALON, shop: SHOP, storeName: "Test", encryptedAccessToken: ENCRYPTED_TOKEN, scopes: [], status: "connected" });

    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random(), topic: "orders/create" } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(result.existing).toEqual([]);
    expect(result.registered).toEqual(["orders/create", "orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"]);
    expect(result.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not create duplicate webhooks for topics that already exist", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [
          { topic: "orders/create", callback_url: WEBHOOK_URI },
          { topic: "orders/paid", callback_url: WEBHOOK_URI },
          { topic: "orders/fulfilled", callback_url: WEBHOOK_URI }
        ] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(result.existing).toEqual(["orders/create", "orders/paid", "orders/fulfilled"]);
    expect(result.registered).toEqual(["orders/cancelled", "checkouts/create"]);
    expect(result.failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports failed topics without throwing", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        const body = JSON.parse(String(opts.body));
        if (body.webhook?.topic === "orders/create") {
          return { ok: false, status: 422, json: async () => ({ errors: { topic: ["has already been taken"] } }) };
        }
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(result.failed).toEqual(["orders/create"]);
    expect(result.registered).toEqual(["orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"]);
  });

  it("is idempotent — second call creates nothing when all topics already exist", async () => {
    const allTopics = ["orders/create", "orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"];
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: allTopics.map((t) => ({ topic: t, callback_url: WEBHOOK_URI })) }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(first.registered).toEqual([]);
    expect(first.existing).toEqual(allTopics);

    const second = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(second.registered).toEqual([]);
    expect(second.existing).toEqual(allTopics);
  });

  it("ignores webhooks with different callback URLs", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [
          { topic: "orders/create", callback_url: "https://other-app.example.com/webhooks" }
        ] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerWebhooks(SHOP, ENCRYPTED_TOKEN);
    expect(result.registered).toEqual(["orders/create", "orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"]);
    expect(result.existing).toEqual([]);
  });

  it("throws when Shopify API fails to list existing webhooks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ errors: "Unauthorized" }) })));
    await expect(registerWebhooks(SHOP, ENCRYPTED_TOKEN)).rejects.toThrow("Failed to list existing webhooks");
  });
});

describe("connectShopifyAndRegisterWebhooks", () => {
  const SHOP = "test-connect.myshopify.com";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges OAuth code then registers webhooks in a single call", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/admin/oauth/access_token")) {
        return { ok: true, json: async () => ({ access_token: "shpat_test_token_123", scope: "read_customers,read_orders,read_products,read_checkouts,write_webhooks" }) };
      }
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await connectShopifyAndRegisterWebhooks(SALON, "user-1", SHOP, "auth-code-123");
    expect(result.shop).toBe(SHOP);
    expect(result.status).toBe("connected");
    expect(result.webhooks).not.toBeNull();
    expect(result.webhooks!.registered).toEqual(["orders/create", "orders/paid", "orders/fulfilled", "orders/cancelled", "checkouts/create"]);
    expect(result.webhookError).toBeNull();
  });

  it("completes OAuth exchange even when webhook registration fails", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/admin/oauth/access_token")) {
        return { ok: true, json: async () => ({ access_token: "shpat_test_token_456", scope: "read_customers" }) };
      }
      if (urlStr.includes("/webhooks.json")) {
        return { ok: false, status: 401, json: async () => ({ errors: "Unauthorized" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await connectShopifyAndRegisterWebhooks(SALON, "user-2", SHOP, "auth-code-456");
    expect(result.shop).toBe(SHOP);
    expect(result.status).toBe("connected");
    expect(result.webhooks).toBeNull();
    expect(result.webhookError).toContain("Failed to list existing webhooks");
  });

  it("provides single unified result for both callback and /connect routes", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/admin/oauth/access_token")) {
        return { ok: true, json: async () => ({ access_token: "shpat_test_token_789", scope: "read_orders" }) };
      }
      if (urlStr.includes("/webhooks.json") && (!opts?.method || opts.method === "GET")) {
        return { ok: true, json: async () => ({ webhooks: [
          { topic: "orders/create", callback_url: "https://salonflow-0o9u.onrender.com/shopify/webhooks" },
          { topic: "orders/paid", callback_url: "https://salonflow-0o9u.onrender.com/shopify/webhooks" }
        ] }) };
      }
      if (urlStr.includes("/webhooks.json") && opts?.method === "POST") {
        return { ok: true, json: async () => ({ webhook: { id: Math.random() } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await connectShopifyAndRegisterWebhooks(SALON, "user-3", SHOP, "auth-code-789");
    expect(result.shop).toBe(SHOP);
    expect(result.status).toBe("connected");
    expect(result.connectedAt).toBeInstanceOf(Date);
    expect(result.webhooks!.existing).toContain("orders/create");
    expect(result.webhooks!.existing).toContain("orders/paid");
    expect(result.webhooks!.registered).toEqual(["orders/fulfilled", "orders/cancelled", "checkouts/create"]);
  });
});
