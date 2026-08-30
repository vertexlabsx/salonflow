import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { BRANCH_ID, TENANT, cleanupCollections, fetchCsrf, seedAuthFixtures } from "./helpers/auth-fixtures";
import { CustomerModel } from "../src/models/customer.model";
import { AppointmentModel } from "../src/models/appointment.model";
import { OwnerSettingsModel } from "../src/models/owner-settings.model";
import { businessDateIn, zonedDayRange } from "../src/shared/business-date";

let app: Express;

async function ownerSession(): Promise<{ accessToken: string; csrfToken: string }> {
  const csrf = await fetchCsrf(app);
  const login = await supertest(app)
    .post("/api/v1/auth/login")
    .set("x-csrf-token", csrf.token)
    .send({ tenantId: TENANT, loginId: "owner", password: "owner@123", device: { type: "owner-app" } });
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
});

describe("owner-console CRM compatibility", () => {
  it("returns branch, access and settings contracts used by owner administration pages", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}` };

    const branches = await supertest(app).get("/api/v1/owner-console/administration/branches").set(auth);
    expect(branches.status).toBe(200);
    expect(branches.body.data.items[0]).toMatchObject({ id: BRANCH_ID, name: "Main Branch", status: "active" });
    expect(branches.body.data.capabilities.create).toBe(true);

    const access = await supertest(app).get("/api/v1/owner-console/administration/access").set(auth);
    expect(access.status).toBe(200);
    expect(access.body.data.roles.some((role: { role: string }) => role.role === "owner")).toBe(true);
    expect(access.body.data.users.some((user: { loginId: string }) => user.loginId === "owner")).toBe(true);

    const settings = await supertest(app).get("/api/v1/owner-console/administration/settings").set(auth).query({ branchId: BRANCH_ID });
    expect(settings.status).toBe(200);
    expect(settings.body.data.settings.localization.currency).toBe("INR");
  });

  it("supports branch creation and status mutation", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/administration/branches").set(auth).send({ name: "Second Branch", city: "Pune", timezone: "Asia/Kolkata" });
    expect(create.status).toBe(201);
    expect(create.body.data.branch.name).toBe("Second Branch");

    const status = await supertest(app).patch(`/api/v1/owner-console/administration/branches/${create.body.data.branch.id}/status`).set(auth).send({ status: "inactive" });
    expect(status.status).toBe(200);
    expect(status.body.data.branch.status).toBe("inactive");
  });

  it("persists owner settings instead of returning only defaults", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };
    const settings = {
      workspace: { workspaceName: "Production Salon", defaultLandingPage: "appointments", fastPosEnabled: false },
      localization: { country: "IN", language: "en", timezone: "Asia/Kolkata", currency: "INR", locale: "en-IN" },
      branchBehavior: { rememberLastBranch: false, requireBranchSelection: true, allowBranchSwitch: true },
      dateTime: { dateFormat: "dd MMM yyyy", timeFormat: "24h", businessDayStartHour: 9, weekStartsOn: "monday" },
      interface: { compactMode: true, showModuleBadges: true, enableCommandSearch: true },
      defaults: { refreshReportsOnOpen: false, ownerNotifications: true, staffHints: false }
    };
    const save = await supertest(app).put("/api/v1/owner-console/administration/settings").set(auth).send({ branchId: BRANCH_ID, settings });
    expect(save.status).toBe(200);
    expect(save.body.data.settings.workspace.workspaceName).toBe("Production Salon");
    expect(await OwnerSettingsModel.countDocuments({ salonId: TENANT, branchId: BRANCH_ID })).toBe(1);

    const load = await supertest(app).get("/api/v1/owner-console/administration/settings").set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: BRANCH_ID });
    expect(load.status).toBe(200);
    expect(load.body.data.settings.interface.compactMode).toBe(true);
  });

  it("supports service administration CRUD", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };
    const create = await supertest(app).post("/api/v1/owner-console/administration/services").set(auth).send({ branchIds: [BRANCH_ID], name: "Production Facial", description: "Deep clean", pricePaise: 150000, durationMinutes: 75, eligibleStaffIds: ["staff_seed_reception"], status: "active" });
    expect(create.status).toBe(201);
    expect(create.body.data.service.pricePaise).toBe(150000);

    const update = await supertest(app).patch(`/api/v1/owner-console/administration/services/${create.body.data.service.id}`).set(auth).send({ pricePaise: 160000, durationMinutes: 80 });
    expect(update.status).toBe(200);
    expect(update.body.data.service.durationMinutes).toBe(80);

    const status = await supertest(app).patch(`/api/v1/owner-console/administration/services/${create.body.data.service.id}/status`).set(auth).send({ status: "inactive" });
    expect(status.status).toBe(200);
    expect(status.body.data.service.status).toBe("inactive");
  });

  it("lists clients and returns client detail from Mongo customers", async () => {
    const session = await ownerSession();
    const customer = await CustomerModel.create({ salonId: TENANT, branchId: BRANCH_ID, name: "Asha Rao", normalizedPhone: "919999999999", whatsappPhoneNumberId: "", interactionStatus: "active", source: "crm", walletBalancePaise: 250000, loyaltyPoints: 420, membershipPlanName: "Glow Gold", membershipCredits: 8, membershipCreditsRemaining: 5, membershipValidUntil: "2027-03-31", membershipStatus: "active", packageName: "Hair Spa Pack", packageCreditsRemaining: 2, subscriptionName: "Monthly Grooming", subscriptionStatus: "active" });
    await AppointmentModel.create({ salonId: TENANT, branchId: BRANCH_ID, staffId: "staff_seed_reception", customerId: String(customer._id), customerName: customer.name, serviceIds: ["svc_haircut"], serviceNames: ["Haircut"], durationMinutes: 30, value: 50000, startAt: new Date(), endAt: new Date(Date.now() + 30 * 60_000), status: "booked", source: "crm" });

    const list = await supertest(app).get("/api/v1/owner-console/operations/clients").set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: "all", page: 1, pageSize: 30 });
    expect(list.status).toBe(200);
    expect(list.body.data.items[0]).toMatchObject({ name: "Asha Rao", phone: "919999999999", walletBalancePaise: 250000, loyaltyPoints: 420, membershipPlanName: "Glow Gold", packageName: "Hair Spa Pack", subscriptionName: "Monthly Grooming" });

    const detail = await supertest(app).get(`/api/v1/owner-console/operations/clients/${customer._id}`).set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: BRANCH_ID });
    expect(detail.status).toBe(200);
    expect(detail.body.data.client.visitCount).toBe(1);
    expect(detail.body.data.client).toMatchObject({ walletBalancePaise: 250000, loyaltyPoints: 420, packageCreditsRemaining: 2, subscriptionStatus: "active" });
    expect(detail.body.data.membership).toMatchObject({ planName: "Glow Gold", planCredits: 8, creditsRemaining: 5, validityDate: "2027-03-31", status: "active" });
    expect(detail.body.data.appointments).toHaveLength(1);
  });

  it("creates and updates client wallet, loyalty, membership, package and subscription fields", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };
    const create = await supertest(app).post("/api/v1/owner-console/operations/clients").set(auth).send({ branchId: BRANCH_ID, name: "Meera Jain", phone: "919111111111", walletBalancePaise: 100000, loyaltyPoints: 80, membershipPlanName: "Silver Care", membershipCredits: 4, membershipCreditsRemaining: 4, membershipValidUntil: "2027-01-31", membershipStatus: "active", packageName: "Blowdry Pack", packageCreditsRemaining: 3, subscriptionName: "Weekly Nails", subscriptionStatus: "paused" });
    expect(create.status).toBe(201);

    const update = await supertest(app).patch(`/api/v1/owner-console/operations/clients/${create.body.data.id}`).set(auth).send({ walletBalancePaise: 150000, loyaltyPoints: 120, membershipCreditsRemaining: 2, subscriptionStatus: "active" });
    expect(update.status).toBe(200);

    const detail = await supertest(app).get(`/api/v1/owner-console/operations/clients/${create.body.data.id}`).set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: BRANCH_ID });
    expect(detail.status).toBe(200);
    expect(detail.body.data.client).toMatchObject({ walletBalancePaise: 150000, loyaltyPoints: 120, packageName: "Blowdry Pack", packageCreditsRemaining: 3, subscriptionName: "Weekly Nails", subscriptionStatus: "active" });
    expect(detail.body.data.membership).toMatchObject({ planName: "Silver Care", creditsRemaining: 2 });
  });

  it("creates, lists, opens and transitions owner appointments", async () => {
    const session = await ownerSession();
    const customer = await CustomerModel.create({ salonId: TENANT, branchId: BRANCH_ID, name: "Nila Shah", normalizedPhone: "918888888888", whatsappPhoneNumberId: "", interactionStatus: "active", source: "crm" });
    const service = await supertest(app).get("/api/v1/owner-console/appointments/options/services").set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: BRANCH_ID });
    const day = zonedDayRange("Asia/Kolkata", businessDateIn("Asia/Kolkata"));
    const startAt = new Date(day.start.getTime() + 12 * 60 * 60_000).toISOString();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/appointments").set(auth).send({ branchId: BRANCH_ID, clientId: String(customer._id), staffId: "staff_seed_reception", serviceIds: [service.body.data.items[0].id], startAt, source: "crm" });
    expect(create.status).toBe(201);
    expect(create.body.data.appointment.clientName).toBe("Nila Shah");

    const list = await supertest(app).get("/api/v1/owner-console/appointments").set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: "all", from: day.start.toISOString(), to: day.end.toISOString() });
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === create.body.data.appointment.id)).toBe(true);

    const detail = await supertest(app).get(`/api/v1/owner-console/appointments/${create.body.data.appointment.id}`).set({ Authorization: `Bearer ${session.accessToken}` });
    expect(detail.status).toBe(200);
    expect(detail.body.data.context.client.name).toBe("Nila Shah");

    const checkIn = await supertest(app).post(`/api/v1/owner-console/appointments/${create.body.data.appointment.id}/check-in`).set(auth).send({});
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.data.appointment.status).toBe("arrived");
  });

  it("rejects concurrent double booking for the same staff and time", async () => {
    const session = await ownerSession();
    const [a, b] = await Promise.all([
      CustomerModel.create({ salonId: TENANT, branchId: BRANCH_ID, name: "Client A", normalizedPhone: "917777777771", whatsappPhoneNumberId: "", interactionStatus: "active", source: "crm" }),
      CustomerModel.create({ salonId: TENANT, branchId: BRANCH_ID, name: "Client B", normalizedPhone: "917777777772", whatsappPhoneNumberId: "", interactionStatus: "active", source: "crm" })
    ]);
    const service = await supertest(app).get("/api/v1/owner-console/appointments/options/services").set({ Authorization: `Bearer ${session.accessToken}` }).query({ branchId: BRANCH_ID });
    const day = zonedDayRange("Asia/Kolkata", businessDateIn("Asia/Kolkata"));
    const startAt = new Date(day.start.getTime() + 13 * 60 * 60_000).toISOString();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };
    const payload = (clientId: string) => ({ branchId: BRANCH_ID, clientId, staffId: "staff_seed_reception", serviceIds: [service.body.data.items[0].id], startAt, source: "crm" });

    const results = await Promise.all([
      supertest(app).post("/api/v1/owner-console/appointments").set(auth).send(payload(String(a._id))),
      supertest(app).post("/api/v1/owner-console/appointments").set(auth).send(payload(String(b._id)))
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
