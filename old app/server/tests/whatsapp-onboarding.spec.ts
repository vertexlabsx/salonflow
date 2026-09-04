import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import supertest from "supertest";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { cleanupCollections, fetchCsrf, seedAuthFixtures, TENANT, BRANCH_ID } from "./helpers/auth-fixtures";
import { WhatsAppConnectionModel } from "../src/models/whatsapp-connection.model";
import { BranchModel } from "../src/models/branch.model";
import { SalonModel } from "../src/models/salon.model";
import { ServiceModel } from "../src/models/service.model";
import { CustomerModel } from "../src/models/customer.model";
import { WhatsAppOutboundModel } from "../src/models/whatsapp-outbound.model";
import { AppointmentModel } from "../src/models/appointment.model";
import { loadEnv, setEnvForTesting } from "../src/config/env";
import { createHmac, generateKeyPairSync, publicEncrypt, randomBytes, createCipheriv, createDecipheriv, constants } from "node:crypto";
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

function flowPrivateKeyPem(): string {
  return loadEnv().WHATSAPP_FLOW_PRIVATE_KEY || "";
}

/** Encrypts a flow data_exchange payload (as Meta does) and returns request + shared AES material. */
function flowBrokerRequest(app: Express, publicKey: string, payload: Record<string, unknown>): { req: supertest.Request; aesKey: Buffer; iv: Buffer } {
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const encryptedFlowData = Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64");
  const encryptedAesKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey).toString("base64");
  const req = supertest(app).post("/api/v1/whatsapp/flows/booking").send({ encrypted_aes_key: encryptedAesKey, initial_vector: iv.toString("base64"), encrypted_flow_data: encryptedFlowData });
  return { req, aesKey, iv };
}

/** Decrypts a flow data_exchange response using the shared AES material. */
function flowBrokerResponse(body: unknown, aesKey: Buffer, iv: Buffer): Record<string, unknown> {
  const decoded = Buffer.from(String(body), "base64");
  const tag = decoded.subarray(decoded.length - 16);
  const ciphertext = decoded.subarray(0, decoded.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(iv.map((byte) => byte ^ 0xff)));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as Record<string, unknown>;
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

  it("greets a fresh chat with the native booking flow form plus a menu follow-up when a Flow ID is configured", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", WHATSAPP_BOOKING_FLOW_ID: "flow_test_123", META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
    const phone = "919999111111";
    const res = await sendWhatsAppSimMessage(app, { from: phone, text: "hi", messageId: "wamid.sim.flowgreet" });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("booking_flow");
    expect(res.body.data.interactive).toMatchObject({ type: "flow" });
    expect(res.body.data.followUp).toMatchObject({ action: "menu", interactive: { type: "list" } });
    expect(res.body.data.interactive.action.parameters).toMatchObject({ flow_id: "flow_test_123", flow_cta: "Book appointment" });

    const outbound = await WhatsAppOutboundModel.find({ salonId: TENANT, toPhone: phone }).lean();
    const flowMessages = outbound.filter((row) => row.interactive && (row.interactive as { type?: string }).type === "flow");
    const menuMessages = outbound.filter((row) => row.interactive && (row.interactive as { type?: string }).type === "list");
    expect(flowMessages.length).toBe(1);
    expect(menuMessages.length).toBe(1);
    const flowMessage = flowMessages[0]!.interactive as { body?: { text?: string } };
    expect(flowMessage.body?.text).toContain("Hi! I can help you book or manage your appointments.");

    const repeat = await sendWhatsAppSimMessage(app, { from: phone, text: "hi", messageId: "wamid.sim.flowgreet.repeat" });
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.action).toBe("booking_flow");
    expect(repeat.body.data.followUp).toMatchObject({ action: "menu", interactive: { type: "list" } });
  });

  it("serves the Appointment Booking template screens (APPOINTMENT -> DETAILS -> SUMMARY) and books once", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", WHATSAPP_FLOW_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
    const service = await ServiceModel.findOne({ salonId: TENANT, name: "Haircut" });
    expect(service).toBeTruthy();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

    const appointmentReq = flowBrokerRequest(app, publicKey.export({ type: "spki", format: "pem" }).toString(), { version: "3.0", action: "data_exchange", screen: "APPOINTMENT", flow_token: `${TENANT}:919999000777:1700000000000`, data: { trigger: "date_selected", department: String(service!._id), location: BRANCH_ID, date: today } });
    const appointmentRes = await appointmentReq.req;
    expect(appointmentRes.status).toBe(200);
    const appointment = flowBrokerResponse(appointmentRes.text, appointmentReq.aesKey, appointmentReq.iv);
    expect(appointment.screen).toBe("APPOINTMENT");
    expect((appointment.data as { department: Array<{ id: string; title: string }> }).department).toEqual(expect.arrayContaining([expect.objectContaining({ id: String(service!._id), title: "Haircut" })]));
    expect((appointment.data as { location: Array<{ id: string; title: string }> }).location).toEqual(expect.arrayContaining([expect.objectContaining({ id: BRANCH_ID, title: "Main Branch" })]));
    expect((appointment.data as { date: Array<{ id: string }> }).date).toHaveLength(14);
    expect((appointment.data as { is_time_enabled: boolean }).is_time_enabled).toBe(true);
    const timeOptions = (appointment.data as { time: Array<{ id: string; title: string }> }).time;
    expect(timeOptions.length).toBeGreaterThan(0);
    expect(timeOptions[0]!.title).toMatch(/^\d{2}:\d{2}$/);
    expect(timeOptions[0]!.id).toContain("|staff_seed_reception");

    const detailsReq = flowBrokerRequest(app, publicKey.export({ type: "spki", format: "pem" }).toString(), { version: "3.0", action: "data_exchange", screen: "DETAILS", flow_token: `${TENANT}:919999000777:1700000000000`, data: { department: String(service!._id), location: BRANCH_ID, date: today, time: timeOptions[0]!.id, name: "Garv Test", email: "garv@test.com", phone: "919999000777", more_details: "Prefers a window seat" } });
    const detailsRes = await detailsReq.req;
    expect(detailsRes.status).toBe(200);
    const details = flowBrokerResponse(detailsRes.text, detailsReq.aesKey, detailsReq.iv);
    expect(details.screen).toBe("SUMMARY");
    expect((details.data as { appointment: string }).appointment).toContain("Haircut");
    expect((details.data as { details: string }).details).toContain("Garv Test");
    expect((details.data as { details: string }).details).toContain("Prefers a window seat");

    const summaryPayload = { version: "3.0", action: "data_exchange", screen: "SUMMARY", flow_token: `${TENANT}:919999000777:1700000000000`, data: { department: String(service!._id), location: BRANCH_ID, date: today, time: timeOptions[0]!.id, name: "Garv Test", email: "garv@test.com", phone: "919999000777", more_details: "Prefers a window seat" } };
    const summaryReq = flowBrokerRequest(app, publicKey.export({ type: "spki", format: "pem" }).toString(), summaryPayload);
    const summaryRes = await summaryReq.req;
    expect(summaryRes.status).toBe(200);
    expect(flowBrokerResponse(summaryRes.text, summaryReq.aesKey, summaryReq.iv).screen).toBe("SUMMARY");

    const booked = await AppointmentModel.findOne({ salonId: TENANT, source: "whatsapp_flow" });
    expect(booked).toBeTruthy();
    expect(booked!.staffId).toBe("staff_seed_reception");
    expect(booked!.customerName).toBe("Garv Test");
    expect(booked!.serviceNames).toContain("Haircut");

    const summaryRepeat = flowBrokerRequest(app, publicKey.export({ type: "spki", format: "pem" }).toString(), summaryPayload);
    const summaryRepeatRes = await summaryRepeat.req;
    expect(summaryRepeatRes.status).toBe(200);
    expect(flowBrokerResponse(summaryRepeatRes.text, summaryRepeat.aesKey, summaryRepeat.iv).screen).toBe("SUMMARY");
    expect(await AppointmentModel.countDocuments({ salonId: TENANT, source: "whatsapp_flow" })).toBe(1);

    const replies = await WhatsAppOutboundModel.find({ salonId: TENANT, toPhone: "919999000777", type: "utility" }).lean();
    expect(replies).toHaveLength(1);
    expect(String(replies[0]!.body)).toContain("appointment is booked");
  });

  it("keeps the two-choice gate when no WhatsApp booking Flow ID is configured", async () => {
    setEnvForTesting({ ...loadEnv(), WHATSAPP_PROVIDER: "mock", WHATSAPP_BOOKING_FLOW_ID: "", META_APP_SECRET: "", META_WEBHOOK_APP_SECRET: "" });
    const phone = "919999111112";
    const res = await sendWhatsAppSimMessage(app, { from: phone, text: "hi", messageId: "wamid.sim.gatefallback" });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe("gate");
    expect(res.body.data.interactive).toMatchObject({ type: "button" });
    expect(res.body.data.followUp).toBeUndefined();
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
