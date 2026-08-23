/**
 * Authentication helper for the Aura Staff App E2E tests.
 *
 * Two credential sets:
 *   Staff — STAFF_TENANT / STAFF_USER / STAFF_PASS
 *   Owner — OWNER_TENANT / OWNER_USER / OWNER_PASS
 *
 * Auth strategies:
 *   Staff: API-level login → inject accessToken into localStorage
 *   Owner: API-level login → httpOnly refresh cookie auto-persists in browser context
 *
 * If no credentials are set via env vars, tests that require auth are skipped.
 */

import { type Page, type BrowserContext } from "@playwright/test";

/* ── Staff Credentials ─────────────────────────────────── */

export const STAFF_CREDENTIALS = {
  tenantId: process.env.STAFF_TENANT || "tenant_aura",
  loginId: process.env.STAFF_USER || "",
  password: process.env.STAFF_PASS || "",
};

/* ── Owner Credentials ─────────────────────────────────── */

export const OWNER_CREDENTIALS = {
  tenantId: process.env.OWNER_TENANT || "tenant_salonist",
  loginId: process.env.OWNER_USER || "",
  password: process.env.OWNER_PASS || "",
};

const API_BASE = process.env.BASE_URL || "http://127.0.0.1:4320";

export function hasStaffCredentials(): boolean {
  return Boolean(STAFF_CREDENTIALS.loginId && STAFF_CREDENTIALS.password);
}

export function hasOwnerCredentials(): boolean {
  return Boolean(OWNER_CREDENTIALS.loginId && OWNER_CREDENTIALS.password);
}

// Backward compat
export const CREDENTIALS = STAFF_CREDENTIALS;
export const hasCredentials = hasStaffCredentials;

/* ── CSRF Token ────────────────────────────────────────── */

async function fetchCsrfToken(api: BrowserContext["request"]): Promise<string> {
  const res = await api.get(`${API_BASE}/api/v1/auth/csrf`);
  if (!res.ok()) return "";
  const body = await res.json().catch(() => ({}));
  return body?.data?.csrfToken || body?.csrfToken || body?.token || "";
}

/* ── Staff API Login ───────────────────────────────────── */

export async function apiLoginStaff(context: BrowserContext): Promise<boolean> {
  if (!hasStaffCredentials()) return false;

  try {
    const csrfToken = await fetchCsrfToken(context.request);

    const loginRes = await context.request.post(`${API_BASE}/api/v1/auth/login`, {
      headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
      data: {
        tenantId: STAFF_CREDENTIALS.tenantId,
        loginId: STAFF_CREDENTIALS.loginId,
        email: STAFF_CREDENTIALS.loginId.includes("@") ? STAFF_CREDENTIALS.loginId : undefined,
        password: STAFF_CREDENTIALS.password,
        device: { type: "staff-app", name: "Aura Staff App", platform: "web" },
      },
    });

    if (!loginRes.ok()) return false;

    const body = await loginRes.json().catch(() => ({}));
    const session = body?.data || body;
    if (!session?.accessToken) return false;

    // Store accessToken in localStorage so the Angular service can pick it up
    await context.addInitScript((token: string) => {
      localStorage.setItem("auraStaffAccessToken", token);
    }, session.accessToken);

    return true;
  } catch {
    return false;
  }
}

/* ── Owner API Login ───────────────────────────────────── */

export async function apiLoginOwner(context: BrowserContext): Promise<boolean> {
  if (!hasOwnerCredentials()) return false;

  try {
    const csrfToken = await fetchCsrfToken(context.request);

    const loginRes = await context.request.post(`${API_BASE}/api/v1/auth/login`, {
      headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
      data: {
        tenantId: OWNER_CREDENTIALS.tenantId,
        email: OWNER_CREDENTIALS.loginId,
        loginId: OWNER_CREDENTIALS.loginId,
        password: OWNER_CREDENTIALS.password,
        device: { type: "owner-app", name: "Aura Owner", platform: "web" },
      },
    });

    if (!loginRes.ok()) return false;

    const body = await loginRes.json().catch(() => ({}));
    const session = body?.data || body;
    if (!session?.accessToken) return false;

    // Owner app uses httpOnly refresh cookie (set by the login response)
    // + in-memory accessToken restored via owner.restore() → refresh()
    // The refresh cookie is already stored in the browser context by context.request.
    // On page load, Angular's ownerAuthGuard calls restore() → refresh() using the cookie.
    // We also inject the accessToken as a fallback so the page doesn't redirect to login.
    await context.addInitScript((token: string) => {
      // Owner app reads token via its in-memory service, but we need
      // the page to load the owner shell. The guard calls restore() which
      // hits /auth/refresh with the cookie. If cookie is set, it works.
      // Store in localStorage as backup for the owner service.
      try { localStorage.setItem("auraOwnerAccessToken", token); } catch { /* */ }
    }, session.accessToken);

    return true;
  } catch {
    return false;
  }
}

// Backward compat
export const apiLogin = apiLoginStaff;

/* ── UI Staff Login (fallback) ─────────────────────────── */

export async function uiLoginStaff(page: Page): Promise<boolean> {
  if (!hasStaffCredentials()) return false;

  try {
    await page.goto("/staff/login", { waitUntil: "networkidle" });

    await page.locator("#staff-tenant-id").fill(STAFF_CREDENTIALS.tenantId);
    await page.locator("#staff-login-id").fill(STAFF_CREDENTIALS.loginId);
    await page.locator("#staff-password").fill(STAFF_CREDENTIALS.password);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/\/staff\/(?!login)/, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/* ── UI Owner Login (fallback) ─────────────────────────── */

export async function uiLoginOwner(page: Page): Promise<boolean> {
  if (!hasOwnerCredentials()) return false;

  try {
    await page.goto("/owner/login", { waitUntil: "networkidle" });

    await page.locator('input[name="tenantId"], #owner-tenant-id').fill(OWNER_CREDENTIALS.tenantId);
    await page.locator('input[name="loginId"], #owner-login-id').fill(OWNER_CREDENTIALS.loginId);
    await page.locator('input[type="password"], #owner-password').fill(OWNER_CREDENTIALS.password);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/\/owner\/(?!login)/, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/* ── Combined Staff Login ──────────────────────────────── */

export async function loginStaff(page: Page): Promise<boolean> {
  const context = page.context();

  // Try API login first — sets httpOnly refresh cookie in browser context
  const apiOk = await apiLoginStaff(context);
  if (apiOk) {
    await page.goto("/staff/dashboard", { waitUntil: "networkidle" });
    if (!page.url().includes("/staff/login")) return true;
  }

  // Fallback to UI login
  return uiLoginStaff(page);
}

/* ── Combined Owner Login ──────────────────────────────── */

export async function loginOwner(page: Page): Promise<boolean> {
  const context = page.context();

  // Try API login first (sets httpOnly refresh cookie)
  const apiOk = await apiLoginOwner(context);
  if (apiOk) {
    await page.goto("/owner/dashboard", { waitUntil: "networkidle" });
    if (!page.url().includes("/owner/login")) return true;
  }

  // Fallback to UI login
  return uiLoginOwner(page);
}

/* ── Navigate to protected staff route (with auto-login) ── */

export async function gotoProtected(page: Page, path: string): Promise<void> {
  const context = page.context();

  // Do API login BEFORE any navigation so the httpOnly refresh cookie
  // is available in the browser context before Angular boots.
  if (!page.context()["__staffApiLoggedIn"]) {
    await apiLoginStaff(context);
    (page.context() as any)["__staffApiLoggedIn"] = true;
  }

  await page.goto(path, { waitUntil: "domcontentloaded" });

  // If Angular still redirected to login (e.g. cookie not picked up), try UI login
  if (page.url().includes("/staff/login")) {
    const ok = await loginStaff(page);
    if (ok) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    }
  }

  // Let Angular settle
  await page.waitForTimeout(400);
}

/* ── Navigate to protected owner route (with auto-login) ── */

export async function gotoProtectedOwner(page: Page, path: string): Promise<void> {
  const context = page.context();

  // Do API login BEFORE any navigation so the httpOnly refresh cookie
  // is available in the browser context before Angular boots.
  if (!(page.context() as any)["__ownerApiLoggedIn"]) {
    await apiLoginOwner(context);
    (page.context() as any)["__ownerApiLoggedIn"] = true;
  }

  await page.goto(path, { waitUntil: "domcontentloaded" });

  // If Angular still redirected to login (e.g. cookie not picked up), try UI login
  if (page.url().includes("/owner/login")) {
    const ok = await loginOwner(page);
    if (ok) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
    }
  }

  // Let Angular settle
  await page.waitForTimeout(400);
}
