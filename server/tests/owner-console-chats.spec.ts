import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { createTestWorld, destroyTestWorld } from "./helpers/world";
import { ConversationMessageModel } from "../src/models/conversation-message.model";
import { TENANT, BRANCH_ID, cleanupCollections, fetchCsrf, loginStaff, createUser, seedAuthFixtures, type StaffSession } from "./helpers/auth-fixtures";

let app: Express;

function auth(session: StaffSession): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}` };
}

async function listConversations(session: StaffSession, query: Record<string, unknown> = {}) {
  return supertest(app).get("/api/v1/owner-console/operations/chats").set(auth(session)).query(query);
}

async function messages(session: StaffSession, conversationId: string, branchId = BRANCH_ID) {
  return supertest(app).get(`/api/v1/owner-console/operations/chats/${encodeURIComponent(conversationId)}/messages`).set(auth(session)).query({ branchId });
}

async function ownerSend(session: StaffSession, conversationId: string, body: string, branchId = BRANCH_ID) {
  const csrf = await fetchCsrf(app);
  return supertest(app)
    .post(`/api/v1/owner-console/operations/chats/${encodeURIComponent(conversationId)}/messages`)
    .set({ ...auth(session), "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
    .send({ branchId, body });
}

async function ownerReceipts(session: StaffSession, conversationId: string, messageIds: string[], status: "delivered" | "read") {
  const csrf = await fetchCsrf(app);
  return supertest(app)
    .post(`/api/v1/owner-console/operations/chats/${encodeURIComponent(conversationId)}/receipts`)
    .set({ ...auth(session), "x-csrf-token": csrf.token })
    .send({ branchId: BRANCH_ID, messageIds, status });
}

async function teamSend(session: StaffSession, conversationId: string, body: string) {
  const csrf = await fetchCsrf(app);
  return supertest(app)
    .post(`/api/v1/team-chat/conversations/${encodeURIComponent(conversationId)}/messages`)
    .set({ ...auth(session), "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
    .send({ body });
}

/** The staff-side conversations list auto-creates the branch team channel; returns its id. */
async function ensureTeamConversation(session: StaffSession): Promise<string> {
  const list = await supertest(app).get("/api/v1/team-chat/conversations").set(auth(session));
  expect(list.status).toBe(200);
  expect(list.body.data.length).toBeGreaterThan(0);
  return list.body.data[0].id as string;
}

async function seedStylist(): Promise<StaffSession> {
  await createUser({
    loginId: "stylist",
    name: "Priya Stylist",
    staffId: "staff_seed_stylist",
    role: "stylist",
    roleDisplayName: "Stylist",
    staffAppPermissions: ["read:appointments", "write:appointments"]
  });
  return loginStaff(app, "stylist", "secret@123");
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

describe("owner-console people/staff", () => {
  it("lists owner staff as the chat picker expects", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    await seedStylist();

    const list = await supertest(app).get("/api/v1/owner-console/people/staff").set(auth(owner)).query({ branchId: "all", status: "active", limit: 200, offset: 0 });
    expect(list.status).toBe(200);
    const items = list.body.data.items as Record<string, unknown>[];
    const stylist = items.find((item) => item.id === "staff_seed_stylist");
    expect(stylist).toMatchObject({
      id: "staff_seed_stylist",
      branchId: BRANCH_ID,
      branchName: "Main Branch",
      fullName: "Priya Stylist",
      firstName: "Priya",
      lastName: "Stylist",
      roleId: "stylist",
      designation: "Stylist",
      loginId: "stylist",
      status: "active",
      employmentType: "full_time"
    });
    expect(list.body.data.page).toMatchObject({ hasMore: false });
  });

  it("filters people/staff by branch, role, and status", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    await seedStylist();

    const stylists = await supertest(app).get("/api/v1/owner-console/people/staff").set(auth(owner)).query({ branchId: BRANCH_ID, role: "stylist" });
    expect(stylists.status).toBe(200);
    expect(stylists.body.data.items.map((item: { id: string }) => item.id)).toEqual(["staff_seed_stylist"]);

    const disabled = await supertest(app).get("/api/v1/owner-console/people/staff").set(auth(owner)).query({ status: "disabled" });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.items).toHaveLength(0);
  });
});

describe("owner-console operations/chats", () => {
  it("shows the branch team channel with unread counts that settle after read receipts", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const stylist = await seedStylist();
    const conversationId = await ensureTeamConversation(owner);

    const initial = await listConversations(owner, { branchId: "all", page: 1, pageSize: 30 });
    expect(initial.status).toBe(200);
    expect(initial.body.data.items[0]).toMatchObject({ id: conversationId, type: "team", title: `${TENANT} Team`, branchName: "Main Branch", unreadCount: 0 });
    expect(initial.body.data.page).toMatchObject({ page: 1, totalPages: 1, hasMore: false });
    expect(initial.body.data.metadata).toMatchObject({ timezone: "Asia/Kolkata", partial: false });

    const sent = await teamSend(stylist, conversationId, "Need more scissors before tomorrow");
    expect(sent.status).toBe(201);

    const afterSend = await listConversations(owner, { branchId: "all" });
    expect(afterSend.body.data.items[0].unreadCount).toBeGreaterThanOrEqual(1);
    expect(afterSend.body.data.items[0].messageCount).toBeGreaterThanOrEqual(1);

    const loaded = await messages(owner, conversationId);
    expect(loaded.status).toBe(200);
    const loadedMessage = loaded.body.data.items[0];
    expect(loadedMessage).toMatchObject({ conversationId, senderName: "Priya Stylist", body: "Need more scissors before tomorrow" });
    expect(loaded.body.data.metadata.branchId).toBe(BRANCH_ID);

    const receiptUpdated = await ownerReceipts(owner, conversationId, [loadedMessage.id], "read");
    expect(receiptUpdated.status).toBe(200);
    expect(receiptUpdated.body.data.conversationId).toBe(conversationId);
    expect(receiptUpdated.body.data.receipts[0].readCount).toBeGreaterThanOrEqual(1);

    const settled = await listConversations(owner, { branchId: "all" });
    expect(settled.body.data.items[0].unreadCount).toBe(0);
  });

  it("lets the owner send messages and search them through the shared text index", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const conversationId = await ensureTeamConversation(owner);

    const created = await ownerSend(owner, conversationId, "Discuss the Diwali campaign budget");
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      conversationId,
      type: "team",
      senderName: "Salon Owner",
      body: "Discuss the Diwali campaign budget",
      receipt: { deliveredCount: 0, readCount: 0 }
    });

    const thread = await messages(owner, conversationId);
    expect(thread.status).toBe(200);
    expect(thread.body.data.items).toHaveLength(1);
    expect(thread.body.data.items[0].body).toBe("Discuss the Diwali campaign budget");

    const global = await supertest(app).get("/api/v1/owner-console/operations/chats/search").set(auth(owner)).query({ q: "Diwali" });
    expect(global.status).toBe(200);
    expect(global.body.data.total).toBe(1);
    expect(global.body.data.items[0]).toMatchObject({ conversationId, conversationTitle: `${TENANT} Team`, branchId: BRANCH_ID });

    const scoped = await supertest(app).get(`/api/v1/owner-console/operations/chats/${conversationId}/search`).set(auth(owner)).query({ q: "budget" });
    expect(scoped.status).toBe(200);
    expect(scoped.body.data.total).toBe(1);
  });

  it("opens a private conversation with a staff member and reuses the same thread", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const stylist = await seedStylist();
    const csrf = await fetchCsrf(app);

    const opened = await supertest(app)
      .post("/api/v1/owner-console/operations/chats/private")
      .set({ ...auth(owner), "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
      .send({ branchId: BRANCH_ID, staffId: "staff_seed_stylist" });
    expect(opened.status).toBe(201);
    expect(opened.body.data).toMatchObject({ type: "private-owner", branchId: BRANCH_ID, branchName: "Main Branch" });
    expect(opened.body.data.participantUserIds).toEqual([owner.user.id, stylist.user.id].sort());

    const reopened = await supertest(app)
      .post("/api/v1/owner-console/operations/chats/private")
      .set({ ...auth(owner), "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
      .send({ branchId: BRANCH_ID, staffId: "staff_seed_stylist" });
    expect(reopened.status).toBe(201);
    expect(reopened.body.data.id).toBe(opened.body.data.id);

    const privateId = opened.body.data.id as string;
    const sent = await ownerSend(owner, privateId, "Welcome to the branch — let me know how the kit is.");
    expect(sent.status).toBe(201);
    expect(sent.body.data.type).toBe("private-owner");

    const thread = await messages(owner, privateId);
    expect(thread.status).toBe(200);
    expect(thread.body.data.items).toHaveLength(1);
    expect(thread.body.data.items[0].senderUserId).toBe(owner.user.id);
  });

  it("enforces authorization and 404s on owner-console chat endpoints", async () => {
    const owner = await loginStaff(app, "owner", "owner@123");
    const conversationId = await ensureTeamConversation(owner);

    const unauth = await supertest(app).get("/api/v1/owner-console/operations/chats");
    expect(unauth.status).toBe(401);

    await createUser({
      loginId: "viewer",
      name: "Read Only",
      staffId: "staff_seed_viewer",
      role: "receptionist",
      staffAppPermissions: ["read:appointments"]
    });
    const viewer = await loginStaff(app, "viewer", "secret@123");

    const visible = await listConversations(viewer, { branchId: "all" });
    expect(visible.status).toBe(200);

    const csrf = await fetchCsrf(app);
    const denied = await supertest(app)
      .post(`/api/v1/owner-console/operations/chats/${conversationId}/messages`)
      .set({ ...auth(viewer), "x-csrf-token": csrf.token, "Idempotency-Key": randomUUID() })
      .send({ branchId: BRANCH_ID, body: "I should not be able to send" });
    expect(denied.status).toBe(403);

    const missing = await supertest(app).get("/api/v1/owner-console/operations/chats/000000000000000000000000/messages").set(auth(owner)).query({ branchId: BRANCH_ID });
    expect(missing.status).toBe(404);

    const badStaff = await supertest(app)
      .post("/api/v1/owner-console/operations/chats/private")
      .set({ ...auth(owner), "x-csrf-token": csrf.token })
      .send({ branchId: BRANCH_ID, staffId: "staff_does_not_exist" });
    expect(badStaff.status).toBe(404);
  });
});