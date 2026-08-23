/**
 * Orientation Change Tests
 *
 * Verifies that rotating between portrait and landscape does not
 * break layouts, cause overflow, or hide critical UI elements.
 *
 * Only runs on mobile/tablet viewports (phones + iPads).
 */

import { test, expect, type Page } from "@playwright/test";
import { hasCredentials, gotoProtected } from "./fixtures/auth.helper";
import {
  hasHorizontalOverflow,
  horizontalOverflowPx,
  waitForAngularSettle,
} from "./fixtures/helpers";

/* ──────────────────────────────────────────────────────── */
/*  Helpers                                                */
/* ──────────────────────────────────────────────────────── */

async function rotateToLandscape(page: Page, originalWidth: number, originalHeight: number) {
  await page.setViewportSize({ width: originalHeight, height: originalWidth });
  await page.waitForTimeout(500);
}

async function rotateToPortrait(page: Page, originalWidth: number, originalHeight: number) {
  await page.setViewportSize({ width: originalWidth, height: originalHeight });
  await page.waitForTimeout(500);
}

/* ──────────────────────────────────────────────────────── */
/*  Login Page Orientation                                 */
/* ──────────────────────────────────────────────────────── */

test.describe("Orientation — Login Page", () => {
  test("login page works in landscape", async ({ page, viewport }) => {
    if (!viewport) return;
    const { width, height } = viewport;
    if (width >= 1024) {
      test.skip(true, "Desktop — orientation test N/A");
      return;
    }

    await page.goto("/staff/login", { waitUntil: "networkidle" });

    // Rotate to landscape (swap width/height)
    await rotateToLandscape(page, width, height);

    // Form should still be usable
    await expect(page.locator("#staff-login-id")).toBeVisible();
    await expect(page.locator("#staff-password")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // No horizontal overflow
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Rotate back
    await rotateToPortrait(page, width, height);
    await expect(page.locator("#staff-login-id")).toBeVisible();
  });
});

/* ──────────────────────────────────────────────────────── */
/*  Owner Login Orientation                                */
/* ──────────────────────────────────────────────────────── */

test.describe("Orientation — Owner Login", () => {
  test("owner login works in landscape", async ({ page, viewport }) => {
    if (!viewport) return;
    const { width, height } = viewport;
    if (width >= 1024) {
      test.skip(true, "Desktop");
      return;
    }

    await page.goto("/owner/login", { waitUntil: "networkidle" });

    await rotateToLandscape(page, width, height);
    await expect(page.locator("#owner-login-id")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await rotateToPortrait(page, width, height);
    await expect(page.locator("#owner-login-id")).toBeVisible();
  });
});

/* ──────────────────────────────────────────────────────── */
/*  Protected Pages Orientation                            */
/* ──────────────────────────────────────────────────────── */

test.describe("Orientation — Staff Dashboard", () => {
  const ORIENTATION_ROUTES = ["/staff/dashboard", "/staff/appointments", "/staff/tasks"];

  for (const route of ORIENTATION_ROUTES) {
    const name = route.split("/").pop()!;

    test(`${name} survives portrait → landscape → portrait`, async ({ page, viewport }) => {
      if (!viewport) return;
      const { width, height } = viewport;
      if (width >= 1024) {
        test.skip(true, "Desktop");
        return;
      }
      if (!hasCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS required");
        return;
      }

      await gotoProtected(page, route);
      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated");
        return;
      }

      // Portrait — baseline
      await waitForAngularSettle(page);
      expect(await hasHorizontalOverflow(page)).toBe(false);

      // Rotate to landscape
      await rotateToLandscape(page, width, height);
      await waitForAngularSettle(page);
      expect(
        await hasHorizontalOverflow(page),
        `${name} overflows in landscape`
      ).toBe(false);

      // Rotate back to portrait
      await rotateToPortrait(page, width, height);
      await waitForAngularSettle(page);
      expect(
        await hasHorizontalOverflow(page),
        `${name} overflows after rotating back`
      ).toBe(false);
    });
  }
});
