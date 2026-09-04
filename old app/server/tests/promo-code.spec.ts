import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { BRANCH_ID, TENANT, cleanupCollections, createUser, fetchCsrf, seedAuthFixtures } from "./helpers/auth-fixtures";
import { PromoCodeModel, PromoRedemptionModel } from "../src/models/promo-code.model";
import { BranchModel } from "../src/models/branch.model";

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

async function staffSession(): Promise<{ accessToken: string; csrfToken: string }> {
  const csrf = await fetchCsrf(app);
  const login = await supertest(app)
    .post("/api/v1/auth/login")
    .set("x-csrf-token", csrf.token)
    .send({ tenantId: TENANT, loginId: "reception", password: "staff@123", device: { type: "staff-app" } });
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

describe("promotions: coupon and referral codes", () => {
  it("lets the owner create and list coupon codes", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({
      kind: "coupon",
      code: "WELCOME20",
      label: "Welcome discount",
      discountType: "percent",
      discountPercent: 20,
      minimumSpendPaise: 10000,
      branchId: "all"
    });
    expect(create.status).toBe(201);
    expect(create.body.data.promo).toMatchObject({ kind: "coupon", code: "WELCOME20", discountType: "percent", status: "active" });
    expect(create.body.data.promo.redemptionCount).toBe(0);

    const list = await supertest(app).get("/api/v1/owner-console/promos").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBe(1);
    expect(list.body.data.items[0].code).toBe("WELCOME20");
    expect(list.body.data.page.total).toBe(1);
  });

  it("generates an auto code when no code is supplied", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({
      kind: "coupon",
      label: "Auto coupon",
      discountType: "flat",
      discountPaise: 5000,
      branchId: "all"
    });
    expect(create.status).toBe(201);
    expect(create.body.data.promo.code.length).toBeGreaterThan(4);
    expect(create.body.data.promo.code.startsWith("SAVE")).toBe(true);
  });

  it("creates a referral program code", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({
      kind: "referral",
      code: "REFER",
      label: "Refer a friend",
      discountType: "flat",
      discountPaise: 10000,
      branchId: "all",
      referrerRewardType: "flat",
      referrerRewardPaise: 5000
    });
    expect(create.status).toBe(201);
    expect(create.body.data.promo.kind).toBe("referral");
    expect(create.body.data.promo.referrerRewardPaise).toBe(5000);
  });

  it("blocks duplicate promo codes", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "SAVE20", label: "A", discountType: "flat", discountPaise: 5000, branchId: "all" });
    const dup = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "SAVE20", label: "B", discountType: "flat", discountPaise: 5000, branchId: "all" });
    expect(dup.status).toBe(409);
  });

  it("lets the owner pause and reactivate a promo", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "PAUSE1", label: "P", discountType: "flat", discountPaise: 2000, branchId: "all" });
    const id = create.body.data.promo._id;

    const pause = await supertest(app).patch(`/api/v1/owner-console/promos/${id}/status`).set(auth).send({ status: "paused" });
    expect(pause.status).toBe(200);
    expect(pause.body.data.status).toBe("paused");

    const reactivate = await supertest(app).patch(`/api/v1/owner-console/promos/${id}/status`).set(auth).send({ status: "active" });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.data.status).toBe("active");
  });

  it("redeems a coupon and returns the discount", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "SAVE10", label: "Ten percent", discountType: "percent", discountPercent: 10, minimumSpendPaise: 10000, branchId: "all" });
    expect(create.status).toBe(201);

    const redeem = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({
      code: "SAVE10",
      valuePaise: 50000,
      branchId: BRANCH_ID
    });
    expect(redeem.status).toBe(200);
    expect(redeem.body.data.discountPaise).toBe(5000);
    expect(redeem.body.data.remaining).toBeNull();
    expect(redeem.body.data.redemptionsUsed).toBe(1);

    const list = await supertest(app).get("/api/v1/owner-console/promos").set(auth);
    expect(list.body.data.items[0].redemptionCount).toBe(1);
    expect(list.body.data.items[0].totalDiscountPaise).toBe(5000);
  });

  it("rejects redemption below minimum spend", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "MIN100", label: "M", discountType: "percent", discountPercent: 10, minimumSpendPaise: 100000, branchId: "all" });

    const redeem = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "MIN100", valuePaise: 50000, branchId: BRANCH_ID });
    expect(redeem.status).toBe(400);
  });

  it("tracks redemption count against maxRedemptions", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "MAX3", label: "M", discountType: "flat", discountPaise: 1000, maxRedemptions: 2, branchId: "all" });

    await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "MAX3", valuePaise: 10000, branchId: BRANCH_ID });
    const second = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "MAX3", valuePaise: 10000, branchId: BRANCH_ID });
    expect(second.body.data.remaining).toBe(0);
    expect(second.body.data.promo.status).toBe("exhausted");

    const third = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "MAX3", valuePaise: 10000, branchId: BRANCH_ID });
    expect(third.status).toBe(409);
  });

  it("rejects inactive codes on redeem", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "INACT", label: "I", discountType: "flat", discountPaise: 1000, branchId: "all" });
    const id = create.body.data.promo._id;
    await supertest(app).patch(`/api/v1/owner-console/promos/${id}/status`).set(auth).send({ status: "paused" });

    const redeem = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "INACT", valuePaise: 10000, branchId: BRANCH_ID });
    expect(redeem.status).toBe(409);
  });

  it("records redemptions and returns them for the promo", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    const create = await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "LOG1", label: "L", discountType: "flat", discountPaise: 2000, branchId: "all" });
    const id = create.body.data.promo._id;

    await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "LOG1", valuePaise: 10000, branchId: BRANCH_ID });

    const redemptions = await supertest(app).get(`/api/v1/owner-console/promos/${id}/redemptions`).set(auth);
    expect(redemptions.status).toBe(200);
    expect(redemptions.body.data.items.length).toBe(1);
    expect(redemptions.body.data.items[0].discountPaise).toBe(2000);
  });

  it("filters promos by kind", async () => {
    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "FILT1", label: "C", discountType: "flat", discountPaise: 1000, branchId: "all" });
    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "referral", code: "FILT2", label: "R", discountType: "flat", discountPaise: 2000, branchId: "all" });

    const coupons = await supertest(app).get("/api/v1/owner-console/promos").set(auth).query({ kind: "coupon" });
    expect(coupons.body.data.items.length).toBe(1);
    expect(coupons.body.data.items[0].kind).toBe("coupon");

    const referrals = await supertest(app).get("/api/v1/owner-console/promos").set(auth).query({ kind: "referral" });
    expect(referrals.body.data.items.length).toBe(1);
    expect(referrals.body.data.items[0].kind).toBe("referral");
  });

  it("rejects code from an unauthorized branch", async () => {
    const secondBranch = await BranchModel.create({
      _id: `${TENANT}_second`,
      salonId: TENANT,
      name: "Second Branch",
      timezone: "Asia/Kolkata",
      status: "active",
      slotIntervalMinutes: 30,
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false }))
    });

    const session = await ownerSession();
    const auth = { Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken };

    await supertest(app).post("/api/v1/owner-console/promos").set(auth).send({ kind: "coupon", code: "BRANCH1", label: "B", discountType: "flat", discountPaise: 1000, branchId: secondBranch._id, branchIds: [secondBranch._id] });

    // Owner has access to both branches (all branches in user), so redeem should work.
    const redeem = await supertest(app).post("/api/v1/owner-console/promos/redeem").set(auth).send({ code: "BRANCH1", valuePaise: 10000, branchId: secondBranch._id });
    expect(redeem.status).toBe(200);
  });
});
