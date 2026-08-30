import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestWorld, destroyTestWorld, testEnv } from "./helpers/world";
import { cleanupCollections, seedAuthFixtures, TENANT, BRANCH_ID } from "./helpers/auth-fixtures";
import { CustomerModel } from "../src/models/customer.model";
import type { Env } from "../src/config/env";
import { conciergeChat } from "../src/modules/whatsapp/concierge.service";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function openAiMessages(content: string | Record<string, unknown>, toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
  const message: Record<string, unknown> = { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) };
  if (toolCalls) {
    message.tool_calls = toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }));
  }
  return { choices: [{ message }] };
}

interface FetchCall {
  url: string;
  body: string;
}

describe("whatsapp concierge (Phase 2)", () => {
  beforeAll(async () => {
    await createTestWorld();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await destroyTestWorld();
  });

  beforeEach(async () => {
    await cleanupCollections();
    await seedAuthFixtures();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function enableConcierge(overrides: Partial<Env> = {}): void {
    testEnv({ WHATSAPP_CONCIERGE_ENABLED: true, OPENAI_API_KEY: "test-key", ...overrides });
  }

  it("returns null when the concierge flag is disabled", async () => {
    testEnv({ WHATSAPP_CONCIERGE_ENABLED: false, OPENAI_API_KEY: "test-key" });
    expect(await conciergeChat({ text: "Hello", salonId: TENANT, branchId: BRANCH_ID, customerId: "nope" })).toBeNull();
  });

  it("returns null without an API key", async () => {
    testEnv({ WHATSAPP_CONCIERGE_ENABLED: true, OPENAI_API_KEY: undefined });
    expect(await conciergeChat({ text: "Hello", salonId: TENANT, branchId: BRANCH_ID, customerId: "nope" })).toBeNull();
  });

  it("runs a tool loop, folds the real catalogue into the conversation, and returns a verified booking proposal", async () => {
    enableConcierge();
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body || "" });
      if (calls.length === 1) {
        return { json: async () => openAiMessages("", [{ id: "call_1", name: "check_availability", args: { branch_id: BRANCH_ID, service_names: ["Haircut"], date: today } }]) };
      }
      return {
        json: async () =>
          openAiMessages({
            reply: "Great! We have Haircut available. Shall I book tomorrow at 12:00 with Front Desk?",
            book: { branch_id: BRANCH_ID, service_names: ["Haircut"], staff_id: "staff_seed_reception", date: today, time_label: "12:00" }
          })
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const customer = await CustomerModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      name: "Mona",
      normalizedPhone: "919876543210",
      whatsappPhoneNumberId: "wa_1",
      source: "whatsapp",
      interactionStatus: "booked",
      preferredStaffIds: ["staff_seed_reception"],
      favoriteServiceIds: [],
      visitCount: 2,
      lastBookedAt: new Date()
    });

    const result = await conciergeChat({ text: "book haircut tomorrow 12", salonId: TENANT, branchId: BRANCH_ID, customerId: String(customer._id) });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      reply: "Great! We have Haircut available. Shall I book tomorrow at 12:00 with Front Desk?",
      proposal: {
        branchId: BRANCH_ID,
        serviceNames: ["Haircut"],
        staffId: "staff_seed_reception",
        staffName: "Front Desk Reception",
        date: today,
        label: "12:00",
        durationMinutes: 30,
        value: 50000
      }
    });
    expect(typeof result!.proposal!.startAt).toBe("string");
    expect(Number.isNaN(Date.parse(result!.proposal!.startAt))).toBe(false);
    expect(calls.length).toBe(2);
    const toolsPassed = JSON.parse(calls[0]!.body).tools as Array<{ function: { name: string } }>;
    expect(toolsPassed.map((t) => t.function.name)).toContain("check_availability");
    const secondRoundMessages = JSON.parse(calls[1]!.body).messages as Array<{ role: string; content?: string }>;
    expect(secondRoundMessages.some((m) => m.role === "tool")).toBe(true);
    expect(secondRoundMessages.find((m) => m.role === "tool")!.content).toContain("Haircut");
  });

  it("closes the loop after a pure text reply and surfaces the handoff flag", async () => {
    enableConcierge();
    const fetchMock = vi.fn(async () => ({
      json: async () => openAiMessages({ reply: "Getting the manager for you.", handoff: true })
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    const customer = await CustomerModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      name: "Mona",
      normalizedPhone: "919876543210",
      whatsappPhoneNumberId: "wa_1",
      source: "whatsapp",
      interactionStatus: "active",
      preferredStaffIds: [],
      favoriteServiceIds: [],
      visitCount: 0,
      lastBookedAt: null
    });
    const result = await conciergeChat({ text: "talk to a human", salonId: TENANT, branchId: BRANCH_ID, customerId: String(customer._id) });
    expect(result).toEqual({ reply: "Getting the manager for you.", handoff: true });
  });

  it("exposes the customer profile tool backed by Phase 5 memory fields", async () => {
    enableConcierge();
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      calls.push({ url: _url, body: init?.body || "" });
      if (calls.length === 1) {
        return { json: async () => openAiMessages("", [{ id: "call_2", name: "get_customer_profile", args: {} }]) };
      }
      return { json: async () => openAiMessages({ reply: "Nice to see you again, Mona!" }) };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const customer = await CustomerModel.create({
      salonId: TENANT,
      branchId: BRANCH_ID,
      name: "Asha",
      normalizedPhone: "919811223344",
      whatsappPhoneNumberId: "wa_2",
      source: "whatsapp",
      interactionStatus: "booked",
      preferredStaffIds: ["staff_seed_reception"],
      favoriteServiceIds: [],
      visitCount: 5,
      lastBookedAt: new Date(Date.now() - 86400_000)
    });

    await conciergeChat({ text: "do you remember me?", salonId: TENANT, branchId: BRANCH_ID, customerId: String(customer._id) });

    const secondRound = JSON.parse(calls[1]!.body).messages as Array<{ role: string; content?: string }>;
    const toolMessage = secondRound.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    const profile = JSON.parse(toolMessage!.content || "{}") as { name?: string; visit_count?: number; preferred_staff?: string[]; favorite_services?: string[] };
    expect(profile.name).toBe("Asha");
    expect(profile.visit_count).toBe(5);
    expect(profile.preferred_staff).toContain("Front Desk Reception");
    expect(profile.favorite_services).toEqual([]);
  });
});