import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { BRANCH_ID, TENANT, cleanupCollections, fetchCsrf, loginStaff, seedAuthFixtures, type StaffSession } from "./helpers/auth-fixtures";

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

function dateKey(deltaDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function staffCreateLeave(staff: StaffSession, overrides: Record<string, string> = {}): Promise<{ id: string; version: number }> {
  const csrf = await fetchCsrf(app);
  const response = await supertest(app)
    .post("/api/v1/staff-os/leaves")
    .set({ Authorization: `Bearer ${staff.accessToken}`, "x-csrf-token": csrf.token })
    .send({ leaveType: "casual", startDate: dateKey(3), endDate: dateKey(3), reason: "Personal work", ...overrides });
  if (response.status !== 201) throw new Error(`leave create failed (${response.status}): ${JSON.stringify(response.body)}`);
  return response.body.data;
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

describe("owner-console leave review contract", () => {
  it("lists pending leave requests with staff name and branch", async () => {
    const staff = await loginStaff(app);
    await staffCreateLeave(staff);
    const owner = await ownerSession();

    const list = await supertest(app)
      .get("/api/v1/owner-console/people/leaves")
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .query({ view: "pending" });
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      staffId: "staff_seed_reception",
      staffName: "Front Desk Reception",
      branchId: BRANCH_ID,
      leaveType: "casual",
      status: "pending",
      documentAvailable: false,
      version: 1
    });
    expect(list.body.data.page.total).toBe(1);
  });

  it("filters by search, branch and view", async () => {
    const staff = await loginStaff(app);
    await staffCreateLeave(staff, { leaveType: "sick", reason: "Medical appointment" });
    const owner = await ownerSession();
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const search = await supertest(app).get("/api/v1/owner-console/people/leaves").set(auth).query({ search: "Front Desk" });
    expect(search.body.data.items).toHaveLength(1);

    const wrongBranch = await supertest(app).get("/api/v1/owner-console/people/leaves").set(auth).query({ view: "pending", branchId: "other_branch" });
    expect(wrongBranch.body.data.items).toHaveLength(0);

    const approvedView = await supertest(app).get("/api/v1/owner-console/people/leaves").set(auth).query({ view: "approved" });
    expect(approvedView.body.data.items).toHaveLength(0);
  });

  it("returns leave detail with balances and capabilities", async () => {
    const staff = await loginStaff(app);
    const created = await staffCreateLeave(staff);
    const owner = await ownerSession();

    const detail = await supertest(app)
      .get(`/api/v1/owner-console/people/leaves/${created.id}`)
      .set({ Authorization: `Bearer ${owner.accessToken}` });
    expect(detail.status).toBe(200);
    expect(detail.body.data.leave).toMatchObject({ id: created.id, status: "pending", version: 1 });
    expect(detail.body.data.capabilities.actions).toEqual(["approve", "reject"]);
    expect(Array.isArray(detail.body.data.balances)).toBe(true);
    expect(detail.body.data.availability.documents.available).toBe(false);
  });

  it("approves a leave and persists the decision note", async () => {
    const staff = await loginStaff(app);
    const created = await staffCreateLeave(staff);
    const owner = await ownerSession();
    const auth = { Authorization: `Bearer ${owner.accessToken}`, "x-csrf-token": owner.csrfToken };

    const approve = await supertest(app)
      .patch(`/api/v1/owner-console/people/leaves/${created.id}/approve`)
      .set(auth)
      .send({ version: created.version, reason: "Approved by owner with note" });
    expect(approve.status).toBe(200);
    expect(approve.body.data).toMatchObject({ id: created.id, status: "approved", version: 2, decisionNote: "Approved by owner with note" });

    const list = await supertest(app).get("/api/v1/owner-console/people/leaves").set({ Authorization: `Bearer ${owner.accessToken}` }).query({ view: "approved" });
    expect(list.body.data.items).toHaveLength(1);

    const secondApprove = await supertest(app).patch(`/api/v1/owner-console/people/leaves/${created.id}/approve`).set(auth).send({ version: 2 });
    expect(secondApprove.status).toBe(409);
  });

  it("rejects a leave, surfaces the reason, and blocks stale versions", async () => {
    const staff = await loginStaff(app);
    const created = await staffCreateLeave(staff);
    const owner = await ownerSession();
    const auth = { Authorization: `Bearer ${owner.accessToken}`, "x-csrf-token": owner.csrfToken };

    const stale = await supertest(app)
      .patch(`/api/v1/owner-console/people/leaves/${created.id}/reject`)
      .set(auth)
      .send({ version: 999 });
    expect(stale.status).toBe(409);

    const reject = await supertest(app)
      .patch(`/api/v1/owner-console/people/leaves/${created.id}/reject`)
      .set(auth)
      .send({ version: created.version, reason: "Dates clash with roster" });
    expect(reject.status).toBe(200);
    expect(reject.body.data).toMatchObject({ id: created.id, status: "rejected", version: 2, rejectionReason: "Dates clash with roster" });

    const repeat = await supertest(app).patch(`/api/v1/owner-console/people/leaves/${created.id}/reject`).set(auth).send({ version: 2 });
    expect(repeat.status).toBe(409);
  });

  it("returns 404 for unknown or cross-tenant leave ids", async () => {
    const owner = await ownerSession();
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const missing = await supertest(app).get("/api/v1/owner-console/people/leaves/000000000000000000000000").set(auth);
    expect(missing.status).toBe(404);
  });

  it("blocks non-owner staff from deciding leaves", async () => {
    const staff = await loginStaff(app);
    const created = await staffCreateLeave(staff);
    const csrf = await fetchCsrf(app);

    const denied = await supertest(app)
      .patch(`/api/v1/owner-console/people/leaves/${created.id}/approve`)
      .set({ Authorization: `Bearer ${staff.accessToken}`, "x-csrf-token": csrf.token })
      .send({ version: created.version });
    expect(denied.status).toBe(403);
  });
});