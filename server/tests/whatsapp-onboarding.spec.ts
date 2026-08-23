import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
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

  it("rejects invalid Meta webhook signatures when an app secret is configured", async () => {
    setEnvForTesting({ ...loadEnv(), META_APP_SECRET: "test-meta-secret" });
    const res = await supertest(app).post("/api/v1/whatsapp/webhook").set("x-hub-signature-256", "sha256=bad").send({ entry: [] });
    expect(res.status).toBe(401);
  });
});
