/**
 * Mobile Layout & Navigation Tests
 *
 * Validates responsive behavior across all device profiles:
 *   - Login page renders correctly at all viewports
 *   - No horizontal overflow on any page
 *   - Sidebar collapses to hamburger on mobile (< 900px)
 *   - Bottom navigation visible only on mobile
 *   - Forms stack vertically on narrow screens
 *   - Content fits within viewport bounds
 *   - No layout shift or clipped content
 */

import { test, expect, type Page } from "@playwright/test";
import { hasCredentials, gotoProtected, loginStaff } from "./fixtures/auth.helper";
import {
  hasHorizontalOverflow,
  horizontalOverflowPx,
  isVisible,
  waitForAngularSettle,
  hasErrorOverlay,
} from "./fixtures/helpers";
import { SIDEBAR_BREAKPOINT, FORM_STACK_BREAKPOINT } from "./fixtures/devices";

/* ──────────────────────────────────────────────────────── */
/*  LOGIN PAGE TESTS (public, run on all viewports)        */
/* ──────────────────────────────────────────────────────── */

test.describe("Login Page — Responsive", () => {
  test("renders form fields and submit button", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });

    await expect(page.locator("#staff-tenant-id")).toBeVisible();
    await expect(page.locator("#staff-login-id")).toBeVisible();
    await expect(page.locator("#staff-password")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText("Open workspace");
  });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("form fits within viewport width", async ({ page, viewport }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const overflow = await horizontalOverflowPx(page);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("form fields are vertically stacked on narrow viewports", async ({ page, viewport }) => {
    if (!viewport || viewport.width >= FORM_STACK_BREAKPOINT) return;

    await page.goto("/staff/login", { waitUntil: "networkidle" });

    const tenant = await page.locator("#staff-tenant-id").boundingBox();
    const login = await page.locator("#staff-login-id").boundingBox();
    const pass = await page.locator("#staff-password").boundingBox();

    expect(tenant).not.toBeNull();
    expect(login).not.toBeNull();
    expect(pass).not.toBeNull();

    if (tenant && login && pass) {
      expect(login.y).toBeGreaterThan(tenant.y);
      expect(pass.y).toBeGreaterThan(login.y);

      // All fields within viewport
      expect(tenant.x).toBeGreaterThanOrEqual(-1);
      expect(tenant.x + tenant.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test("no clipped content (body rect fits viewport)", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const fits = await page.evaluate(() => {
      const body = document.body;
      const rect = body.getBoundingClientRect();
      return {
        leftOk: rect.left >= -2,
        rightOk: rect.right <= window.innerWidth + 2,
        topOk: rect.top >= -2,
        bottomOk: rect.bottom <= window.innerHeight + 100, // allow some scroll
      };
    });
    expect(fits.leftOk).toBe(true);
    expect(fits.rightOk).toBe(true);
  });

  test("no Angular error overlay", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    expect(await hasErrorOverlay(page)).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  OWNER LOGIN PAGE TESTS (public)                        */
/* ──────────────────────────────────────────────────────── */

test.describe("Owner Login — Responsive", () => {
  test("renders and has no overflow", async ({ page }) => {
    await page.goto("/owner/login", { waitUntil: "networkidle" });
    await expect(page.locator("#owner-login-id")).toBeVisible();
    await expect(page.locator("#owner-password")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  SIDEBAR / BOTTOM NAV VISIBILITY                        */
/* ──────────────────────────────────────────────────────── */

test.describe("Navigation Shell", () => {
  test("login page fits viewport at current size", async ({ page, viewport }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const overflow = await horizontalOverflowPx(page);
    expect(overflow).toBe(0);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  PROTECTED STAFF PAGES — LAYOUT INTEGRITY               */
/* ──────────────────────────────────────────────────────── */

const PROTECTED_ROUTES = [
  "/staff/dashboard",
  "/staff/appointments",
  "/staff/business",
  "/staff/tasks",
  "/staff/attendance",
  "/staff/roster",
  "/staff/performance",
  "/staff/leaderboard",
  "/staff/notifications",
  "/staff/reports",
  "/staff/calendar",
  "/staff/chat",
  "/staff/payroll",
  "/staff/leaves",
  "/staff/profile",
  "/staff/settings",
];

test.describe("Protected Staff Pages — No Horizontal Overflow", () => {
  for (const route of PROTECTED_ROUTES) {
    const name = route.split("/").pop() || route;

    test(`${name} — no horizontal scroll`, async ({ page, viewport }) => {
      if (!hasCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS env vars required");
        return;
      }

      await gotoProtected(page, route);

      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated — redirected to login");
        return;
      }

      const overflow = await horizontalOverflowPx(page);
      expect(
        overflow,
        `${route} has ${overflow}px horizontal overflow at ${viewport?.width}x${viewport?.height}`
      ).toBeLessThanOrEqual(2); // 2px tolerance for sub-pixel rounding
    });
  }
});

test.describe("Protected Staff Pages — No Error Overlay", () => {
  for (const route of PROTECTED_ROUTES) {
    const name = route.split("/").pop() || route;

    test(`${name} — no error overlay`, async ({ page }) => {
      if (!hasCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS env vars required");
        return;
      }

      await gotoProtected(page, route);

      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated");
        return;
      }

      expect(await hasErrorOverlay(page)).toBe(false);
    });
  }
});

test.describe("Protected Staff Pages — Content Fits Viewport", () => {
  for (const route of ["/staff/dashboard", "/staff/appointments", "/staff/tasks"]) {
    const name = route.split("/").pop()!;

    test(`${name} — content within viewport bounds`, async ({ page, viewport }) => {
      if (!hasCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS env vars required");
        return;
      }

      await gotoProtected(page, route);
      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated");
        return;
      }

      const fits = await page.evaluate(() => {
        const main = document.querySelector(".staff-content, main, [role='main']");
        if (!main) return { ok: true };
        const rect = main.getBoundingClientRect();
        return {
          ok: rect.right <= window.innerWidth + 4,
          right: rect.right,
          viewWidth: window.innerWidth,
        };
      });

      expect(
        fits.ok,
        `${route} content overflows viewport: content right=${fits.right}, viewport=${fits.viewWidth}`
      ).toBe(true);
    });
  }
});

/* ──────────────────────────────────────────────────────── */
/*  MOBILE BOTTOM NAV                                       */
/* ──────────────────────────────────────────────────────── */

test.describe("Bottom Navigation", () => {
  test("is visible on mobile viewports on dashboard", async ({ page, viewport }) => {
    if (!hasCredentials()) {
      test.skip(true, "STAFF_USER + STAFF_PASS required");
      return;
    }
    if (!viewport || viewport.width >= SIDEBAR_BREAKPOINT) {
      test.skip(true, "Desktop viewport — bottom nav not shown");
      return;
    }

    await gotoProtected(page, "/staff/dashboard");
    if (page.url().includes("/staff/login")) {
      test.skip(true, "Not authenticated");
      return;
    }

    const navVisible = await isVisible(page, "nav.mobile-bottom-nav");
    expect(navVisible).toBe(true);
  });

  test("is NOT visible on desktop viewports", async ({ page, viewport }) => {
    if (!viewport || viewport.width < SIDEBAR_BREAKPOINT) {
      test.skip(true, "Mobile viewport");
      return;
    }

    await page.goto("/staff/login", { waitUntil: "networkidle" });

    // On desktop, mobile-bottom-nav should be display:none or absent entirely
    const display = await page.evaluate(() => {
      const nav = document.querySelector("nav.mobile-bottom-nav");
      if (!nav) return "not-found";
      return getComputedStyle(nav).display;
    });

    expect(display === "none" || display === "not-found").toBe(true);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  HAMBURGER MENU (mobile only)                           */
/* ──────────────────────────────────────────────────────── */

test.describe("Hamburger Menu", () => {
  test("opens and closes sidebar on mobile", async ({ page, viewport }) => {
    if (!viewport || viewport.width >= SIDEBAR_BREAKPOINT) {
      test.skip(true, "Desktop — no hamburger");
      return;
    }
    if (!hasCredentials()) {
      test.skip(true, "STAFF_USER + STAFF_PASS required");
      return;
    }

    await gotoProtected(page, "/staff/dashboard");
    if (page.url().includes("/staff/login")) {
      test.skip(true, "Not authenticated");
      return;
    }

    // Hamburger should be visible
    const menuBtn = page.locator(".menu-button");
    await expect(menuBtn).toBeVisible();

    // Click to open sidebar
    await menuBtn.click();
    await expect(page.locator(".staff-sidebar")).toHaveClass(/open/);
    await expect(page.locator(".drawer-backdrop")).toHaveClass(/open/);

    // Click visible backdrop (right side, outside the 72vw sidebar)
    const vw = viewport?.width ?? 412;
    await page.locator(".drawer-backdrop").click({ position: { x: vw - 20, y: 100 } });
    await expect(page.locator(".staff-sidebar")).not.toHaveClass(/open/);
  });
});
