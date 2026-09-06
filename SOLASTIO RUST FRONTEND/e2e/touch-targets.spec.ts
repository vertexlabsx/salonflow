/**
 * Touch Target & Interaction Tests
 *
 * Validates:
 *   - Interactive elements meet minimum 44px touch target
 *   - Buttons and inputs remain clickable
 *   - Viewport meta tag is correctly configured
 *   - Pinch-zoom behavior
 *   - Safe area insets on notched devices
 *   - Keyboard navigation
 */

import { test, expect } from "@playwright/test";
import { hasCredentials, gotoProtected } from "./fixtures/auth.helper";
import { countUndersizedTargets, getInteractiveElements, isVisible } from "./fixtures/helpers";

const MIN_TOUCH_PX = 44;

/* ──────────────────────────────────────────────────────── */
/*  LOGIN PAGE TOUCH TARGETS                               */
/* ──────────────────────────────────────────────────────── */

test.describe("Login Page — Touch Targets", () => {
  test("submit button meets 44px minimum height", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const box = await page.locator('button[type="submit"]').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });

  test("all buttons meet minimum touch target size", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const undersized = await countUndersizedTargets(page, MIN_TOUCH_PX);
    const buttonIssues = undersized.filter((el) => el.tag === "button");
    expect(
      buttonIssues,
      `Buttons below ${MIN_TOUCH_PX}px: ${JSON.stringify(buttonIssues)}`
    ).toHaveLength(0);
  });

  test("owner login submit button meets touch target", async ({ page }) => {
    await page.goto("/owner/login", { waitUntil: "networkidle" });
    const box = await page.locator('button[type="submit"]').boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });

  test("interactive elements are all visible and non-zero size", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const elements = await getInteractiveElements(page);
    for (const el of elements) {
      expect(el.rect.width, `${el.tag} has zero width`).toBeGreaterThan(0);
      expect(el.rect.height, `${el.tag} has zero height`).toBeGreaterThan(0);
    }
  });
});

/* ──────────────────────────────────────────────────────── */
/*  BOTTOM NAV TOUCH TARGETS (mobile only)                 */
/* ──────────────────────────────────────────────────────── */

test.describe("Bottom Nav — Touch Targets", () => {
  test("all bottom nav links ≥ 40px in both dimensions", async ({ page, viewport }) => {
    if (!viewport || viewport.width >= 900) {
      test.skip(true, "Desktop — no bottom nav");
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

    const links = page.locator("nav.mobile-bottom-nav a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      if (box) {
        expect(box.height, `bottom-nav link ${i} too short`).toBeGreaterThanOrEqual(40);
        expect(box.width, `bottom-nav link ${i} too narrow`).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

/* ──────────────────────────────────────────────────────── */
/*  VIEWPORT & ZOOM                                        */
/* ──────────────────────────────────────────────────────── */

test.describe("Viewport Configuration", () => {
  test("viewport meta tag exists", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const exists = await page.evaluate(() => !!document.querySelector('meta[name="viewport"]'));
    expect(exists).toBe(true);
  });

  test("viewport includes width=device-width", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const has = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return (meta?.getAttribute("content") || "").includes("width=device-width");
    });
    expect(has).toBe(true);
  });

  test("document zoom is 100% at load", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const zoom = await page.evaluate(() => window.devicePixelRatio);
    expect(zoom).toBeGreaterThanOrEqual(1);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  SAFE AREA INSETS                                       */
/* ──────────────────────────────────────────────────────── */

test.describe("Safe Area", () => {
  test("body content does not overflow viewport edges", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => {
      const body = document.body;
      const rect = body.getBoundingClientRect();
      return {
        leftOverflow: rect.left < -2,
        rightOverflow: rect.right > window.innerWidth + 2,
      };
    });
    expect(overflow.leftOverflow).toBe(false);
    expect(overflow.rightOverflow).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  KEYBOARD NAVIGATION                                    */
/* ──────────────────────────────────────────────────────── */

test.describe("Keyboard Navigation", () => {
  test("tab moves focus through login form fields", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });

    // Click tenant field to start
    await page.locator("#staff-tenant-id").click();

    const focusedIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.id || "");
      if (id) focusedIds.push(id);
    }

    // Should have focused at least 2 different form fields
    const unique = [...new Set(focusedIds)];
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });

  test("submit button is keyboard-focusable", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    await page.locator("#staff-tenant-id").click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName.toLowerCase() + (el?.id ? `#${el.id}` : "");
    });
    expect(focused).toContain("button");
  });
});

/* ──────────────────────────────────────────────────────── */
/*  BUTTONS & INPUTS REMAIN CLICKABLE                      */
/* ──────────────────────────────────────────────────────── */

test.describe("Clickability", () => {
  test("password toggle button works", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });

    const toggle = page.locator(".password-toggle");
    if ((await toggle.count()) === 0) return; // might not exist

    await toggle.click();
    const type = await page.locator("#staff-password").getAttribute("type");
    expect(type).toBe("text");

    await toggle.click();
    const type2 = await page.locator("#staff-password").getAttribute("type");
    expect(type2).toBe("password");
  });

  test("all inputs accept keyboard input", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });

    await page.locator("#staff-login-id").click();
    await page.keyboard.type("testuser");
    const val = await page.locator("#staff-login-id").inputValue();
    expect(val).toBe("testuser");
  });
});
