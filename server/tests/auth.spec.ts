import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import {
  TENANT,
  cleanupCollections,
  createUser,
  fetchCsrf,
  loginStaff,
  seedAuthFixtures
} from "./helpers/auth-fixtures";

let app: Express;

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

describe("GET /api/v1/auth/csrf", () => {
  it("issues a signed csrf token with expiry and sets the cookie", async () => {
    const response = await supertest(app).get("/api/v1/auth/csrf");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.csrfToken).toBeTruthy();
    expect(new Date(response.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(response.headers["set-cookie"]?.[0]).toContain("auraCsrf=");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("rejects a mutation without a csrf token (403 with csrf message)", async () => {
    const response = await supertest(app).post("/api/v1/auth/login").send({ tenantId: TENANT, loginId: "reception", password: "staff@123" });
    expect(response.status).toBe(403);
    expect(response.body.error.message.toLowerCase()).toContain("csrf");
  });

  it("logs a staff user in and returns the exact session contract the Staff App expects", async () => {
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", (await fetchCsrf(app)).token)
      .send({ tenantId: TENANT, loginId: "reception", password: "staff@123", device: { type: "staff-app" } });

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.user.staffId).toBe("staff_seed_reception");
    expect(data.user.role).toBe("receptionist");
    expect(data.user.branchId).toBe(`${TENANT}_main`);
    expect(Array.isArray(data.user.branchIds)).toBe(true);
    expect(data.user.permissions).toContain("read:appointments");
    expect(data.tenant).toEqual({ id: TENANT, name: "Aura Shine Salon & Wellness" });
  });

  it("supports email-based login identifiers", async () => {
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", (await fetchCsrf(app)).token)
      .send({ tenantId: TENANT, loginId: "owner@aurashine.test", password: "owner@123" });
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("owner");
  });

  it("returns an owner session including tenant name for the Owner App", async () => {
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", (await fetchCsrf(app)).token)
      .send({ tenantId: TENANT, loginId: "owner", password: "owner@123", device: { type: "owner-app" } });
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("owner");
    expect(response.body.data.tenant.name).toBeTruthy();
    // Owner refresh cookie must be set for cookie-based restore.
    expect(String(response.headers["set-cookie"])).toContain("auraRefresh=");
  });

  it("uniformly rejects unknown users and wrong passwords as 401 envelope errors", async () => {
    const csrf = (await fetchCsrf(app)).token;
    const wrongUser = await supertest(app).post("/api/v1/auth/login").set("x-csrf-token", csrf).send({ tenantId: TENANT, loginId: "nobody", password: "x" });
    const wrongPassword = await supertest(app).post("/api/v1/auth/login").set("x-csrf-token", csrf).send({ tenantId: TENANT, loginId: "reception", password: "wrong" });
    expect(wrongUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.success).toBe(false);
    expect(typeof wrongPassword.body.error.message).toBe("string");
  });

  it("rejects an unknown tenant id", async () => {
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", (await fetchCsrf(app)).token)
      .send({ tenantId: "tenant_ghost", loginId: "reception", password: "staff@123" });
    expect(response.status).toBe(401);
  });

  it("blocks disabled accounts with 403", async () => {
    await createUser({ loginId: "disabled1", password: "secret@123", status: "disabled" });
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", (await fetchCsrf(app)).token)
      .send({ tenantId: TENANT, loginId: "disabled1", password: "secret@123" });
    expect(response.status).toBe(403);
  });

  it("challenges for TOTP when enabled and fails closed on missing/invalid codes", async () => {
    await createUser({ loginId: "manager2fa", password: "secret@123", totpEnabled: true });
    const csrf = (await fetchCsrf(app)).token;
    const missing = await supertest(app).post("/api/v1/auth/login").set("x-csrf-token", csrf).send({ tenantId: TENANT, loginId: "manager2fa", password: "secret@123" });
    expect(missing.status).toBe(401);
    expect(missing.body.error.details?.requiresTotp).toBe(true);

    const wrong = await supertest(app)
      .post("/api/v1/auth/login")
      .set("x-csrf-token", csrf)
      .send({ tenantId: TENANT, loginId: "manager2fa", password: "secret@123", twoFactorCode: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.details?.requiresTotp).toBe(true);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates body refresh tokens (native staff path) and invalidates the old token", async () => {
    const session = await loginStaff(app);

    const first = await supertest(app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeTruthy();

    // Rotation: the original token must now be rejected.
    const replay = await supertest(app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
  });

  it("refreshes via httpOnly cookie (owner web path) without a body token", async () => {
    const agent = supertest.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf");
    const login = await agent.post("/api/v1/auth/login").set("x-csrf-token", csrf.body.data.csrfToken).send({
      tenantId: TENANT,
      loginId: "owner",
      password: "owner@123",
      device: { type: "owner-app" }
    });
    expect(login.status).toBe(200);

    const refreshed = await agent.post("/api/v1/auth/refresh").send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  it("refuses revoked tokens after logout", async () => {
    const session = await loginStaff(app);
    await supertest(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ refreshToken: session.refreshToken });

    const replay = await supertest(app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
  });

  it("rejects malformed refresh payloads", async () => {
    const response = await supertest(app).post("/api/v1/auth/refresh").send({ refreshToken: "not-a-real-token" });
    expect(response.status).toBe(401);
  });
});

describe("WebAuthn compatibility surface", () => {
  it.each(["/api/v1/auth/webauthn/register/begin", "/api/v1/auth/webauthn/login/begin"])(
    "issues a signed challenge for %s",
    async (path) => {
      const csrfRes = await supertest(app).get("/api/v1/auth/csrf");
      const response = await supertest(app)
        .post(path)
        .set("x-csrf-token", String(csrfRes.body?.data?.csrfToken ?? ""))
        .send({ tenantId: TENANT, loginId: "reception" });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.challengeToken).toBeTruthy();
      expect(response.body.data.publicKey.challenge).toBeTruthy();
    }
  );

  it("fails finish endpoints explicitly until credentials are enrolled", async () => {
    const csrfRes = await supertest(app).get("/api/v1/auth/csrf");
    const register = await supertest(app)
      .post("/api/v1/auth/webauthn/register/finish")
      .set("x-csrf-token", String(csrfRes.body?.data?.csrfToken ?? ""))
      .send({});
    expect(register.status).toBe(501);
    expect(String(register.body.error.message)).toMatch(/registration/i);

    const login = await supertest(app)
      .post("/api/v1/auth/webauthn/login/finish")
      .set("x-csrf-token", String(csrfRes.body?.data?.csrfToken ?? ""))
      .send({});
    expect(login.status).toBe(401);
    expect(String(login.body.error.message)).toMatch(/password sign-in/i);
  });
});

describe("GET /api/v1/auth/demo-staff-session", () => {
  it("is unavailable in production mode", async () => {
    // Rebuild env in production mode for this assertion using the same world.
    const { testEnv } = await import("./helpers/world");
    const uri = process.env.MONGODB_URI_TEST || "";
    void uri;
    testEnv({ NODE_ENV: "production" });
    try {
      const response = await supertest(app).get("/api/v1/auth/demo-staff-session");
      expect([404, 501]).toContain(response.status);
    } finally {
      testEnv({ NODE_ENV: "test" });
    }
  });
});
