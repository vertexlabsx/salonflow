import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import supertest from "supertest";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { cleanupCollections, fetchCsrf, seedAuthFixtures, TENANT } from "./helpers/auth-fixtures";
import { WhatsAppConnectionModel } from "../src/models/whatsapp-connection.model";
import { BranchModel } from "../src/models/branch.model";
import { SalonModel } from "../src/models/salon.model";
import { ServiceModel } from "../src/models/service.model";
import { CustomerModel } from "../src/models/customer.model";
import { loadEnv, setEnvForTesting } from "../src/config/env";
import { createHmac } from "node:crypto";
import { encryptSecret } from "../src/shared/secret-box";
import { sendWhatsAppMessage } from "../src/modules/whatsapp/whatsapp.service";
import { sendWhatsAppSimMessage } from "./helpers/whatsapp-simulator";

let app: Express;

async function ownerSession(): Promise<{ accessToken: string; csrfToken: string }> {
  const csrf = await fetchCsrf(app);
  const login = await supertest(app).post("/api/v1/auth/login").set("x-csrf-token", csrf.token).send({ tenantId: TENANT, loginId: "owner", password: "owner@123", device: { type: "owner-app" } });
  expect(login.status).toBe(200);
  return { accessToken: login.body.data.accessToken as string, csrfToken: csrf.token };
}

beforeAll(async () => {
  ({ app } = await createTestWorld());
});

afterAll(async () => {
  await destroyTestWorld();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await cleanupCollections();
  await seedAuthFixtures();
  setEnvForTesting({ ...loadEnv(), META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
});

describe("multi-tenant WhatsApp onboarding", () => {
  it("verifies Meta challenge on root webhook using VERIFY_TOKEN", async () => {
    setEnvForTesting({ ...loadEnv(), VERIFY_TOKEN: "verify-root-token", META_WEBHOOK_VERIFY_TOKEN: "" });
    const res = await supertest(app).get("/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "verify-root-token", "hub.challenge": "challenge-123" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge-123");
  });

  it("returns safe connection status without credential leakage", async () => {
    await WhatsAppConnectionModel.create({ salonId: TENANT, provider: "meta_production", wabaId: "waba_a", phoneNumberId: "phone_a", displayPhoneNumber: "+919999999999", verifiedName: "Aura WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner" });
    const session = await ownerSession();
    const res = await supertest(app).get("/api/v1/whatsapp/status").set({ Authorization: `Bearer ${session.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.data.connections[0]).toMatchObject({ salonId: TENANT, phoneNumberId: "phone_a", status: "connected", webhookSubscribed: true });
    expect(res.body.data.connections[0].encryptedAccessToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("encrypted-secret");
  });

  it("does not start Embedded Signup when Meta app config is missing", async () => {
    const session = await ownerSession();
    const res = await supertest(app).post("/api/v1/whatsapp/embedded-signup/state").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({});
    expect(res.status).toBe(501);
  });

  it("rejects unauthenticated Embedded Signup start", async () => {
    const res = await supertest(app).post("/api/v1/whatsapp/embedded-signup/start").send({});
    expect(res.status).toBe(401);
  });

  it("generates durable one-time signup state and rejects replay", async () => {
    setEnvForTesting({ ...loadEnv(), META_APP_ID: "1739408257311822", META_APP_SECRET: "meta-secret", META_CONFIG_ID: "2140964753518474", VERIFY_TOKEN: "verify" });
    const session = await ownerSession();
    const start = await supertest(app).post("/api/v1/whatsapp/embedded-signup/start").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({});
    expect(start.status).toBe(201);
    expect(start.body.data).toMatchObject({ appId: "1739408257311822", configId: "2140964753518474" });
    const invalid = await supertest(app).post("/api/v1/whatsapp/embedded-signup/callback").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({ state: `${start.body.data.state}x`, authorizationCode: "code_12345", wabaId: "waba" });
    expect(invalid.status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad OAuth access_token=EAASECRET" } }) })));
    const first = await supertest(app).post("/api/v1/whatsapp/embedded-signup/callback").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({ state: start.body.data.state, authorizationCode: "code_12345", wabaId: "waba" });
    expect(first.status).toBe(400);
    expect(JSON.stringify(first.body)).not.toContain("EAASECRET");
    const replay = await supertest(app).post("/api/v1/whatsapp/embedded-signup/callback").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({ state: start.body.data.state, authorizationCode: "code_12345", wabaId: "waba" });
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toContain("already been used");
  });

  it("scopes status and disconnect to the authenticated salon", async () => {
    await SalonModel.create({ _id: "tenant_b", name: "Beta Salon", timezone: "Asia/Kolkata", currency: "INR", status: "active", whatsappPhoneNumberIds: [] });
    await WhatsAppConnectionModel.create({ salonId: "tenant_b", provider: "meta_production", wabaId: "waba_b", phoneNumberId: "phone_b", displayPhoneNumber: "+918888888888", verifiedName: "Beta WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner_b" });
    await WhatsAppConnectionModel.create({ salonId: TENANT, provider: "meta_production", wabaId: "waba_a", phoneNumberId: "phone_a", displayPhoneNumber: "+919999999999", verifiedName: "Aura WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner" });
    const session = await ownerSession();
    const status = await supertest(app).get("/api/v1/whatsapp/status").set({ Authorization: `Bearer ${session.accessToken}` });
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).toContain("phone_a");
    expect(JSON.stringify(status.body)).not.toContain("phone_b");
    const disconnectOther = await supertest(app).post("/api/v1/whatsapp/disconnect").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({ phoneNumberId: "phone_b" });
    expect(disconnectOther.status).toBe(404);
    const disconnectOwn = await supertest(app).post("/api/v1/whatsapp/disconnect").set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken }).send({ phoneNumberId: "phone_a" });
    expect(disconnectOwn.status).toBe(200);
    expect((await WhatsAppConnectionModel.findOne({ phoneNumberId: "phone_b" }))?.status).toBe("connected");
  });

  it("rejects duplicate phoneNumberId across salons", async () => {
    await WhatsAppConnectionModel.create({ salonId: TENANT, provider: "meta_production", wabaId: "waba_a", phoneNumberId: "phone_shared", displayPhoneNumber: "+919999999999", verifiedName: "Aura WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner" });
    await expect(WhatsAppConnectionModel.create({ salonId: "tenant_b", provider: "meta_production", wabaId: "waba_b", phoneNumberId: "phone_shared", displayPhoneNumber: "+918888888888", verifiedName: "Beta WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner_b" })).rejects.toThrow();
  });

  it("uses the connected salon token for outbound Meta sends", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "meta_production", META_WHATSAPP_TOKEN: "global-token", META_WABA_PHONE_NUMBER_ID: "global-phone" });
    await WhatsAppConnectionModel.create({ salonId: TENANT, provider: "meta_production", wabaId: "waba_a", phoneNumberId: "phone_a", displayPhoneNumber: "+919999999999", verifiedName: "Aura WhatsApp", status: "connected", encryptedAccessToken: encryptSecret("tenant-token-a"), webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner" });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.outbound" }] }) }));
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsAppMessage({ salonId: TENANT, toPhone: "919999000000", type: "utility", body: "Hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(String(calls[0]?.[0])).toContain("/phone_a/messages");
    expect(calls[0]?.[1].headers).toMatchObject({ Authorization: "Bearer tenant-token-a" });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("global-token");
  });

  it("routes inbound webhook messages by phoneNumberId to the owning salon", async () => {
    await SalonModel.create({ _id: "tenant_b", name: "Beta Salon", timezone: "Asia/Kolkata", currency: "INR", status: "active", whatsappPhoneNumberIds: [] });
    await BranchModel.create({ _id: "tenant_b_main", salonId: "tenant_b", name: "Main", timezone: "Asia/Kolkata", status: "active", slotIntervalMinutes: 30, hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false })) });
    await ServiceModel.create({ salonId: "tenant_b", branchIds: ["tenant_b_main"], name: "Haircut", pricePaise: 50000, durationMinutes: 30, eligibleStaffIds: [], status: "active" });
    await WhatsAppConnectionModel.create({ salonId: "tenant_b", provider: "meta_production", wabaId: "waba_b", phoneNumberId: "phone_b", displayPhoneNumber: "+918888888888", verifiedName: "Beta WhatsApp", status: "connected", encryptedAccessToken: "encrypted-secret", webhookSubscribed: true, connectedAt: new Date(), createdBy: "owner_b" });

    const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone_b" }, contacts: [{ profile: { name: "Same Customer" }, wa_id: "919999000000" }], messages: [{ id: "wamid.route_b", from: "919999000000", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Book appointment" } }] } }] }] };
    const activeSecret = loadEnv().META_APP_SECRET || "";
    let request = supertest(app).post("/api/v1/whatsapp/webhook").set("x-test-webhook", "true");
    if (activeSecret) {
      const raw = JSON.stringify(payload);
      const signature = createHmac("sha256", activeSecret).update(raw, "utf8").digest("hex");
      request = request.set("content-type", "application/json").set("x-hub-signature-256", `sha256=${signature}`);
      const res = await request.send(raw);
      expect(res.status).toBe(200);
    } else {
      const res = await request.send(payload);
      expect(res.status).toBe(200);
    }
    expect(await CustomerModel.findOne({ salonId: "tenant_b", normalizedPhone: "919999000000" })).toBeTruthy();
    expect(await CustomerModel.findOne({ salonId: TENANT, normalizedPhone: "919999000000" })).toBeFalsy();
  });

  it("simulates a no-AI customer flow through gate, menu, and FAQ", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
    const first = await sendWhatsAppSimMessage(app, { text: "hi", messageId: "wamid.sim.gate" });
    expect(first.status).toBe(200);
    expect(first.body.data.action).toBe("gate");
    expect(first.body.data.reply).toContain("Book appointment");

    const menu = await sendWhatsAppSimMessage(app, { text: "menu", messageId: "wamid.sim.menu" });
    expect(menu.status).toBe(200);
    expect(menu.body.data.action).toBe("menu");

    const faq = await sendWhatsAppSimMessage(app, { text: "are you open tomorrow?", messageId: "wamid.sim.hours" });
    expect(faq.status).toBe(200);
    expect(faq.body.data.action).toBe("faq_day_hours");
    expect(faq.body.data.reply).toContain("10:00 - 21:00");
  });

  it("simulates price-to-book context without AI", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
    const phone = "919999000001";
    await sendWhatsAppSimMessage(app, { from: phone, text: "hi", messageId: "wamid.sim2.gate" });
    await sendWhatsAppSimMessage(app, { from: phone, text: "menu", messageId: "wamid.sim2.menu" });
    const price = await sendWhatsAppSimMessage(app, { from: phone, text: "hair ct price", messageId: "wamid.sim2.price" });
    expect(price.status).toBe(200);
    expect(price.body.data.action).toBe("needs_date");
    expect(price.body.data.reply).toContain("Haircut");
    const next = await sendWhatsAppSimMessage(app, { from: phone, text: "yes", messageId: "wamid.sim2.yes" });
    expect(next.status).toBe(200);
    expect(next.body.data.action).toBe("needs_date");
  });

  it("rejects invalid Meta webhook signatures when an app secret is configured", async () => {
    setEnvForTesting({ ...loadEnv(), META_APP_SECRET: "test-meta-secret" });
    const res = await supertest(app).post("/api/v1/whatsapp/webhook").set("x-hub-signature-256", "sha256=bad").send({ entry: [] });
    expect(res.status).toBe(401);
  });
});
