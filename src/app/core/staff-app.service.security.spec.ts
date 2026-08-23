import "@angular/compiler";
import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { Observable, Subject, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./csrf.interceptor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./csrf.interceptor")>();
  return { ...actual, resetCsrfState: vi.fn(actual.resetCsrfState) };
});

type RequestOptions = { headers?: HttpHeaders; withCredentials?: boolean };
type Responder = (method: "GET" | "POST" | "PATCH", url: string, body: unknown, options: RequestOptions) => Observable<unknown>;

const sharedCalls: Array<{ method: "GET" | "POST" | "PATCH"; url: string; body: unknown; options: RequestOptions }> = [];
let mockCapacitorHttpResponder: Responder | null = null;

function recordCall(method: "GET" | "POST" | "PATCH", url: string, body: unknown, options: RequestOptions): void {
  sharedCalls.push({ method, url, body, options });
}

function firstValueFrom<T>(obs: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => { obs.subscribe({ next: resolve, error: reject }); });
}

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  CapacitorHttp: {
    get: (opts: { url: string; headers?: Record<string, string> }) => {
      const hdrs = new HttpHeaders(opts.headers || {});
      const options: RequestOptions = { headers: hdrs };
      recordCall("GET", opts.url, undefined, options);
      if (!mockCapacitorHttpResponder) return Promise.resolve({ data: {}, status: 200, headers: {} });
      return firstValueFrom(mockCapacitorHttpResponder("GET", opts.url, undefined, options)).then(
        (data) => ({ data, status: 200, headers: {} })
      );
    },
    post: (opts: { url: string; headers?: Record<string, string>; data?: unknown }) => {
      const hdrs = new HttpHeaders(opts.headers || {});
      const options: RequestOptions = { headers: hdrs };
      recordCall("POST", opts.url, opts.data, options);
      if (!mockCapacitorHttpResponder) return Promise.resolve({ data: {}, status: 200, headers: {} });
      return firstValueFrom(mockCapacitorHttpResponder("POST", opts.url, opts.data, options)).then(
        (data) => ({ data, status: 200, headers: {} })
      );
    },
    patch: (opts: { url: string; headers?: Record<string, string>; data?: unknown }) => {
      const hdrs = new HttpHeaders(opts.headers || {});
      const options: RequestOptions = { headers: hdrs };
      recordCall("PATCH", opts.url, opts.data, options);
      if (!mockCapacitorHttpResponder) return Promise.resolve({ data: {}, status: 200, headers: {} });
      return firstValueFrom(mockCapacitorHttpResponder("PATCH", opts.url, opts.data, options)).then(
        (data) => ({ data, status: 200, headers: {} })
      );
    },
  },
}));

import { resetCsrfState } from "./csrf.interceptor";
import { isQueuedMutation, StaffAppService, StaffUser } from "./staff-app.service";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const user = (id: string, loginId = `${id}.staff`): StaffUser => ({
  id,
  loginId,
  name: `Staff ${id}`,
  email: `${loginId}@example.test`,
  role: "staff",
  staffId: `staff-${id}`,
  branchId: "branch-1",
  branchIds: ["branch-1"],
  permissions: ["read:appointments", "write:staff"]
});

const loginSession = (id: string, accessToken = `access-${id}`) => ({
  accessToken,
  refreshToken: `refresh-${id}`,
  user: user(id)
});

function serviceWith(responder: Responder): { service: StaffAppService; calls: typeof sharedCalls } {
  mockCapacitorHttpResponder = responder;
  const http = { get: vi.fn(), post: vi.fn(), patch: vi.fn() } as unknown as HttpClient;
  return { service: new StaffAppService(http), calls: sharedCalls };
}

function setOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online, credentials: undefined }
  });
}

function storedQueue(): Array<Record<string, unknown>> {
  const value: unknown = JSON.parse(localStorage.getItem("auraStaffOfflineQueue") || "[]");
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

describe("StaffAppService security behavior", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
    setOnline(true);
    vi.mocked(resetCsrfState).mockClear();
    mockCapacitorHttpResponder = null;
    sharedCalls.length = 0;
  });

  it("keeps login access, refresh, and user session material out of localStorage", async () => {
    const session = loginSession("one", "access-secret");
    const { service } = serviceWith((_method, url) => url.endsWith("/auth/login") ? of(session) : of({}));

    await service.login({ tenantId: "tenant-one", loginId: "one.staff", password: "password" });

    expect(service.isAuthenticated()).toBe(true);
    expect(localStorage.getItem("auraStaffAccessToken")).toBeNull();
    expect(localStorage.getItem("auraStaffRefreshToken")).toBeNull();
    expect(localStorage.getItem("auraStaffSession")).toBeNull();
    const persistedValues = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) || "") || "").join(" ");
    expect(persistedValues).not.toContain("access-secret");
    expect(persistedValues).not.toContain("refresh-one");
    expect(persistedValues).not.toContain("staff-one");
  });

  it("shares one refresh request between concurrent requests without an access token", async () => {
    const refresh = new Subject<unknown>();
    const { service, calls } = serviceWith((method, url) => {
      if (method === "POST" && url.endsWith("/auth/refresh")) return refresh;
      if (method === "GET" && url.endsWith("/staff-self/dashboard")) return of({ summary: {} });
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });

    const first = service.dashboard();
    const second = service.dashboard();
    await Promise.resolve();

    expect(calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
    refresh.next({ accessToken: "refreshed-access", user: user("one") });
    refresh.complete();
    await Promise.all([first, second]);

    expect(calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/staff-self/dashboard"))).toHaveLength(2);
  });

  it("refreshes an oversized legacy session after the proxy returns HTML 400", async () => {
    let dashboardCalls = 0;
    const { service, calls } = serviceWith((method, url) => {
      if (method === "POST" && url.endsWith("/auth/refresh")) return of(loginSession("one", "compact-access"));
      if (method === "GET" && url.endsWith("/staff-self/dashboard")) {
        dashboardCalls += 1;
        if (dashboardCalls === 1) return throwError(() => new HttpErrorResponse({ status: 400, error: "<!DOCTYPE html><title>400 Bad Request</title>" }));
        return of({ staff: user("one"), summary: {} });
      }
      return throwError(() => new Error(`Unexpected request: ${method} ${url}`));
    });
    service.openSession(loginSession("one", "x".repeat(16_000)));

    await service.dashboard();

    expect(calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/staff-self/dashboard"))).toHaveLength(2);
  });

  it("clears all local auth state when backend logout fails", async () => {
    const session = loginSession("one");
    const { service } = serviceWith((method, url) => {
      if (method === "POST" && url.endsWith("/auth/login")) return of(session);
      if (method === "POST" && url.endsWith("/auth/logout")) return throwError(() => new Error("backend unavailable"));
      return of({});
    });
    await service.login({ tenantId: "tenant-one", loginId: "one.staff", password: "password" });
    vi.mocked(resetCsrfState).mockClear();
    localStorage.setItem("auraStaffBiometricLoginHint", JSON.stringify({ tenantId: "tenant-one", loginId: "one.staff" }));
    localStorage.setItem("auraStaffOfflineQueue", JSON.stringify([{ queueId: "queued" }]));
    localStorage.setItem("auraStaffOfflineQueueLease", JSON.stringify({ owner: "other" }));
    localStorage.setItem("auraStaffRecent", JSON.stringify([{ path: "/staff/dashboard" }]));
    localStorage.setItem("auraStaffAccessToken", "legacy-access");
    localStorage.setItem("auraStaffRefreshToken", "legacy-refresh");
    localStorage.setItem("auraStaffSession", "legacy-session");

    await expect(service.logout()).resolves.toBeUndefined();

    expect(resetCsrfState).toHaveBeenCalledOnce();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.biometricEnabled()).toBe(false);
    for (const key of ["auraStaffBiometricLoginHint", "auraStaffOfflineQueue", "auraStaffOfflineQueueLease", "auraStaffRecent", "auraStaffAccessToken", "auraStaffRefreshToken", "auraStaffSession"]) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });

  it("scopes queued entries to the current user, tenant, and session and clears them on account change", async () => {
    let activeSession = loginSession("one");
    const { service } = serviceWith((_method, url) => url.endsWith("/auth/login") ? of(activeSession) : of({}));
    await service.login({ tenantId: "tenant-one", loginId: "one.staff", password: "password" });
    setOnline(false);

    const result = await service.completeTask("task-1", 3);
    const [entry] = storedQueue();

    expect(isQueuedMutation(result)).toBe(true);
    expect(entry).toMatchObject({ userId: "one", tenantId: "tenant-one", method: "PATCH", state: "pending" });
    expect(entry["sessionId"]).toEqual(expect.any(String));
    expect(entry["sessionId"]).not.toBe("");

    setOnline(true);
    activeSession = loginSession("two");
    await service.login({ tenantId: "tenant-two", loginId: "two.staff", password: "password" });

    expect(service.user()?.id).toBe("two");
    expect(service.offlineQueueSize()).toBe(0);
    expect(localStorage.getItem("auraStaffOfflineQueue")).toBeNull();
  });

  it("returns a queued mutation result and reuses its idempotency key during flush", async () => {
    const session = loginSession("one");
    const { service, calls } = serviceWith((method, url) => {
      if (method === "POST" && url.endsWith("/auth/login")) return of(session);
      if (method === "PATCH" && url.endsWith("/staff-os/tasks/task-1")) return of({ updated: true });
      return of({});
    });
    await service.login({ tenantId: "tenant-one", loginId: "one.staff", password: "password" });
    setOnline(false);
    const result = await service.completeTask("task-1", 5);

    expect(result).toEqual({ state: "queued", queueId: expect.any(String), idempotencyKey: expect.any(String) });
    if (!isQueuedMutation(result)) throw new Error("Expected queued mutation result.");
    const queuedIdempotencyKey = result.idempotencyKey;

    setOnline(true);
    await expect(service.flushOfflineActions()).resolves.toBe(1);

    const flush = calls.find((call) => call.method === "PATCH" && call.url.endsWith("/staff-os/tasks/task-1"));
    expect(flush?.options.headers?.get("Idempotency-Key")).toBe(queuedIdempotencyKey);
    expect(service.offlineQueueSize()).toBe(0);
  });
});
