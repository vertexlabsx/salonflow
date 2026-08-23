import "@angular/compiler";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Observable, Subject, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerAppService } from "./owner-app.service";

type Call = { method: "GET" | "POST"; url: string; body?: unknown; options?: { headers?: { get(name: string): string | null }; withCredentials?: boolean } };
type Responder = (call: Call) => Observable<unknown>;

class MockHttpClient {
  readonly calls: Call[] = [];
  constructor(private readonly responder: Responder) {}
  get = vi.fn((url: string) => this.respond({ method: "GET", url }));
  post = vi.fn((url: string, body: unknown, options?: Call["options"]) => this.respond({ method: "POST", url, body, options }));
  patch = vi.fn();
  put = vi.fn();
  private respond(call: Call): Observable<unknown> { this.calls.push(call); return this.responder(call); }
}

const ownerSession = (accessToken = "owner-access") => ({
  accessToken,
  user: { id: "owner-1", name: "Owner", email: "owner@example.test", role: "owner", branchId: "branch-1", branchIds: ["branch-1"] },
  tenant: { id: "tenant-1", name: "Aura Test" }
});

function serviceWith(responder: Responder): { service: OwnerAppService; http: MockHttpClient } {
  const http = new MockHttpClient(responder);
  return { service: new OwnerAppService(http as unknown as HttpClient), http };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

describe("OwnerAppService security behavior", () => {
  beforeEach(() => Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() }));
  it("completes a TOTP challenge without discarding the entered credentials", async () => {
    let attempts = 0;
    const { service, http } = serviceWith((call) => {
      if (call.method === "POST" && call.url.endsWith("/auth/login")) {
        attempts++;
        if (attempts === 1) return throwError(() => new HttpErrorResponse({ status: 401, error: { success: false, error: { message: "Two-factor authentication code required", details: { requiresTotp: true } } } }));
        return of(ownerSession());
      }
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });

    const credentials = { tenantId: "tenant-1", loginId: "owner", password: "password" };
    await expect(service.login(credentials)).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(service.requiresTotp()).toBe(true);

    await service.login({ ...credentials, totpToken: "123456" });

    expect(service.isOwner()).toBe(true);
    expect(service.requiresTotp()).toBe(false);
    expect(http.calls[1]?.body).toMatchObject({ tenantId: "tenant-1", loginId: "owner", password: "password", totpToken: "123456", twoFactorCode: "123456" });
  });

  it("shares one refresh between route restoration and concurrent owner API calls", async () => {
    const refresh = new Subject<unknown>();
    const { service, http } = serviceWith((call) => {
      if (call.method === "POST" && call.url.endsWith("/auth/refresh")) return refresh;
      if (call.method === "GET" && call.url.endsWith("/finance/summary")) return of({ total: 1 });
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });

    const restoration = service.restore();
    const first = service.financeSummary();
    const second = service.financeSummary();
    await vi.waitFor(() => expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1));

    refresh.next(ownerSession("refreshed-access"));
    refresh.complete();
    await Promise.all([restoration, first, second]);

    expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(http.calls.filter((call) => call.url.endsWith("/finance/summary"))).toHaveLength(2);
  });

  it("shares one refresh between concurrent 401 retries", async () => {
    const refresh = new Subject<unknown>();
    let protectedCalls = 0;
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(ownerSession("expired-access"));
      if (call.url.endsWith("/auth/refresh")) return refresh;
      if (call.method === "GET" && call.url.endsWith("/finance/summary")) {
        protectedCalls++;
        return protectedCalls <= 2 ? throwError(() => new HttpErrorResponse({ status: 401 })) : of({ total: 1 });
      }
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });
    await service.login({ tenantId: "tenant-1", loginId: "owner", password: "password" });

    const first = service.financeSummary();
    const second = service.financeSummary();
    await vi.waitFor(() => expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1));

    refresh.next(ownerSession("refreshed-access"));
    refresh.complete();
    await Promise.all([first, second]);
    expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("refreshes an oversized legacy owner session after the proxy returns HTML 400", async () => {
    let protectedCalls = 0;
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(ownerSession("x".repeat(16_000)));
      if (call.url.endsWith("/auth/refresh")) return of(ownerSession("compact-access"));
      if (call.method === "GET" && call.url.endsWith("/finance/summary")) {
        protectedCalls += 1;
        if (protectedCalls === 1) return throwError(() => new HttpErrorResponse({ status: 400, error: "<!DOCTYPE html><title>400 Bad Request</title>" }));
        return of({ total: 1 });
      }
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });
    await service.login({ tenantId: "tenant-1", loginId: "owner", password: "password" });

    await service.financeSummary();

    expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(http.calls.filter((call) => call.url.endsWith("/finance/summary"))).toHaveLength(2);
  });

  it("invalidates the owner shell when refresh fails", async () => {
    const unauthorized = new HttpErrorResponse({ status: 401, error: { error: { message: "Refresh token expired" } } });
    const { service } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(ownerSession("stale-access"));
      if (call.url.endsWith("/finance/summary")) return throwError(() => new HttpErrorResponse({ status: 401 }));
      if (call.url.endsWith("/auth/refresh")) return throwError(() => unauthorized);
      return throwError(() => new Error("Unexpected request"));
    });
    await service.login({ tenantId: "tenant-1", loginId: "owner", password: "password" });

    await expect(service.financeSummary()).rejects.toBe(unauthorized);

    expect(service.user()).toBeNull();
    expect(service.isOwner()).toBe(false);
    expect(service.sessionExpired()).toBe(true);
  });

  it("blocks cookie restoration and retries revocation after logout network failure", async () => {
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(ownerSession());
      if (call.url.endsWith("/auth/logout")) return throwError(() => new Error("offline"));
      if (call.url.endsWith("/auth/refresh")) return of(ownerSession("must-not-restore"));
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });
    await service.login({ tenantId: "tenant-1", loginId: "owner", password: "password" });

    await service.logout();
    expect(localStorage.getItem("auraOwner:logoutPending")).toBe("true");
    await expect(service.restore()).resolves.toBe(false);

    expect(http.calls.filter((call) => call.url.endsWith("/auth/logout"))).toHaveLength(2);
    expect(http.calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(0);
  });

  it("logs out with an expired access token without refreshing first", async () => {
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(ownerSession("expired-access"));
      if (call.url.endsWith("/auth/logout")) return of({ revoked: true });
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });
    await service.login({ tenantId: "tenant-1", loginId: "owner", password: "password" });

    await expect(service.logout()).resolves.toBe(true);

    const logout = http.calls.find((call) => call.url.endsWith("/auth/logout"));
    expect(logout?.options?.withCredentials).toBe(true);
    expect(logout?.options?.headers?.get("Authorization")).toBe("Bearer expired-access");
    expect(http.calls.some((call) => call.url.endsWith("/auth/refresh"))).toBe(false);
    expect(service.isOwner()).toBe(false);
  });

  it("waits for an in-flight refresh and revokes the rotated session", async () => {
    const refresh = new Subject<unknown>();
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/refresh")) return refresh;
      if (call.url.endsWith("/finance/summary")) return of({ total: 1 });
      if (call.url.endsWith("/auth/logout")) return of({ revoked: true });
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });

    const request = service.financeSummary();
    await Promise.resolve();
    const logout = service.logout();
    refresh.next(ownerSession("rotated-access"));
    refresh.complete();

    await expect(logout).resolves.toBe(true);
    await expect(request).rejects.toThrow("Owner sign-out is in progress");
    const logoutCall = http.calls.find((call) => call.url.endsWith("/auth/logout"));
    expect(logoutCall?.options?.headers?.get("Authorization")).toBe("Bearer rotated-access");
    expect(service.isOwner()).toBe(false);
  });

  it("rejects a non-owner login and disposes its refresh session", async () => {
    const staffSession = { ...ownerSession("staff-access"), user: { ...ownerSession().user, role: "manager" } };
    const { service, http } = serviceWith((call) => {
      if (call.url.endsWith("/auth/login")) return of(staffSession);
      if (call.url.endsWith("/auth/logout")) return of({ revoked: true });
      return throwError(() => new Error(`Unexpected request: ${call.method} ${call.url}`));
    });

    await expect(service.login({ tenantId: "tenant-1", loginId: "manager", password: "password" })).rejects.toThrow("reserved for the salon owner");

    expect(service.isOwner()).toBe(false);
    const logout = http.calls.find((call) => call.url.endsWith("/auth/logout"));
    expect(logout?.options?.headers?.get("Authorization")).toBe("Bearer staff-access");
    expect(logout?.options?.withCredentials).toBe(true);
  });
});
