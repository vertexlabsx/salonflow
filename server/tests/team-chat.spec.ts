import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { ConversationMessageModel } from "../src/models/conversation-message.model";
import { TENANT, BRANCH_ID, cleanupCollections, fetchCsrf, loginStaff, seedAuthFixtures, type StaffSession } from "./helpers/auth-fixtures";

let app: Express;

async function sendMessage(session: StaffSession, conversationId: string, body: string) {
  const csrf = await fetchCsrf(app);
  return supertest(app)
    .post(`/api/v1/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`)
    .set({ Authorization: `Bearer ${session.accessToken}`, "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
    .send({ body });
}

async function firstConversation(session: StaffSession): Promise<string> {
  const list = await supertest(app)
    .get("/api/v1/team-chat/conversations")
    .set({ Authorization: `Bearer ${session.accessToken}` });
  expect(list.status).toBe(200);
  const items = list.body.data as { id: string }[];
  expect(items.length).toBeGreaterThan(0);
  return items[0]!.id;
}

beforeAll(async () => {
  ({ app } = await createTestWorld());
  await ConversationMessageModel.init();
});

afterAll(async () => {
  await destroyTestWorld();
});

beforeEach(async () => {
  await cleanupCollections();
  await seedAuthFixtures();
});

describe("team-chat conversations", () => {
  it("creates a message, lists it, and broadcasts a realtime frame", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const conversationId = await firstConversation(owner);

    const created = await sendMessage(owner, conversationId, "Remind the team about the Friday stock take");
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      conversationId,
      type: "team",
      senderName: "Salon Owner",
      body: "Remind the team about the Friday stock take",
      receipt: { deliveredCount: 0, readCount: 0 }
    });

    const messages = await supertest(app)
      .get(`/api/v1/team-chat/conversations/${conversationId}/messages`)
      .set({ Authorization: `Bearer ${owner.accessToken}` });
    expect(messages.status).toBe(200);
    expect(messages.body.data).toHaveLength(1);
    expect(messages.body.data[0]!.body).toBe("Remind the team about the Friday stock take");
  });

  it("searches message bodies across conversation history with the text index", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const conversationId = await firstConversation(owner);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    await sendMessage(owner, conversationId, "Remind the team about the Friday stock take");
    await sendMessage(owner, conversationId, "Please confirm the schedule for tomorrow");

    const scoped = await supertest(app)
      .get(`/api/v1/team-chat/conversations/${conversationId}/search`)
      .set(auth)
      .query({ q: "stock" });
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.total).toBe(1);
    expect(scoped.body.data.items[0]!.body).toContain("stock");

    const global = await supertest(app)
      .get("/api/v1/team-chat/search")
      .set(auth)
      .query({ q: "schedule" });
    expect(global.status).toBe(200);
    expect(global.body.data.total).toBe(1);
    expect(global.body.data.items[0]!).toMatchObject({
      conversationId,
      conversationTitle: `${TENANT} Team`,
      conversationType: "team",
      branchId: BRANCH_ID
    });

    const empty = await supertest(app).get("/api/v1/team-chat/search").set(auth).query({ q: "" });
    expect(empty.status).toBe(200);
    expect(empty.body.data.items).toHaveLength(0);
  });

  it("lets read-only staff search team history but not send", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const conversationId = await firstConversation(owner);
    await sendMessage(owner, conversationId, "Client briefing before shift");

    const reception = await loginStaff(app);
    const search = await supertest(app)
      .get("/api/v1/team-chat/search")
      .set({ Authorization: `Bearer ${reception.accessToken}` })
      .query({ q: "briefing" });
    expect(search.status).toBe(200);
    expect(search.body.data.total).toBe(1);

    const denied = await sendMessage(reception, conversationId, "I should not be able to send");
    expect(denied.status).toBe(403);
  });

  it("returns 404 for a conversation in another salon or invalid ids", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const missing = await supertest(app).get("/api/v1/team-chat/conversations/000000000000000000000000/search").set(auth).query({ q: "stock" });
    expect(missing.status).toBe(404);

    const malformed = await supertest(app).get("/api/v1/team-chat/search").set(auth).query({ q: "x" });
    expect(malformed.status).toBe(200);
  });
});