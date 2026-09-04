import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";

let app: Express;

beforeAll(async () => {
  ({ app } = await createTestWorld());
});

afterAll(async () => {
  await destroyTestWorld();
});

describe("API envelope and transport contracts", () => {
  it("exposes /api/v1/health in the success envelope", async () => {
    const response = await supertest(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: expect.objectContaining({ status: "ok" }) });
  });

  it("returns a 404 envelope for unknown API routes", async () => {
    const response = await supertest(app).get("/api/v1/definitely-not-a-route");
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(typeof response.body.error.message).toBe("string");
  });

  it("answers CORS preflight for the configured origin with credentials", async () => {
    const response = await supertest(app)
      .options("/api/v1/auth/csrf")
      .set("Origin", "http://127.0.0.1:4320")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "content-type");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4320");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects disallowed CORS origins", async () => {
    const response = await supertest(app)
      .get("/api/v1/auth/csrf")
      .set("Origin", "https://evil.example.com");
    expect(response.status).toBe(400);
  });

  it("allows browser-less native clients (no Origin header)", async () => {
    const response = await supertest(app).get("/api/v1/auth/csrf");
    expect(response.status).toBe(200);
  });

  it("rejects malformed JSON bodies with a 400 envelope", async () => {
    const response = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("x-csrf-token", "anything-valid-shaped")
      .send("{broken json");
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
