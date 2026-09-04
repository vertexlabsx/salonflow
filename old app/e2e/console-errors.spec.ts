/**
 * Console Error Monitoring Tests
 *
 * Verifies that no JavaScript runtime errors occur on any page.
 * Tests both public pages (login) and protected pages (after auth).
 */

import { test, expect, type Page } from "@playwright/test";
import { hasStaffCredentials, gotoProtected, hasOwnerCredentials, gotoProtectedOwner } from "./fixtures/auth.helper";
import {
  ConsoleError,
  collectConsoleErrors,
  filterIgnorableErrors,
  waitForAngularSettle,
  hasErrorOverlay,
} from "./fixtures/helpers";
import { STAFF_ROUTES, OWNER_ROUTES } from "./fixtures/routes";

/* ──────────────────────────────────────────────────────── */
/*  Helpers                                                */
/* ──────────────────────────────────────────────────────── */

async function checkPageForConsoleErrors(page: Page, path: string): Promise<ConsoleError[]> {
  const errors: ConsoleError[] = [];
  const detach = collectConsoleErrors(page, errors);

  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForAngularSettle(page);

  // Interact slightly to trigger lazy-loaded modules
  await page.waitForTimeout(600);

  detach();
  return filterIgnorableErrors(errors);
}

/* ──────────────────────────────────────────────────────── */
/*  PUBLIC PAGES — Console Errors                          */
/* ──────────────────────────────────────────────────────── */

test.describe("Console Errors — Public Pages", () => {
  const publicRoutes = STAFF_ROUTES.filter((r) => r.public);

  for (const route of publicRoutes) {
    test(`${route.label} — no console errors`, async ({ page }) => {
      const errors = await checkPageForConsoleErrors(page, route.path);
      expect(
        errors,
        `Console errors on ${route.path}:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`
      ).toHaveLength(0);
    });
  }

  test("owner login — no console errors", async ({ page }) => {
    const errors = await checkPageForConsoleErrors(page, "/owner/login");
    expect(errors).toHaveLength(0);
  });
});

/* ──────────────────────────────────────────────────────── */
/*  PROTECTED STAFF PAGES — Console Errors                 */
/* ──────────────────────────────────────────────────────── */

test.describe("Console Errors — Protected Pages", () => {
  const protectedRoutes = STAFF_ROUTES.filter((r) => !r.public);

  for (const route of protectedRoutes) {
    test(`${route.label} — no console errors`, async ({ page }) => {
      if (!hasStaffCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS required");
        return;
      }

      await gotoProtected(page, route.path);

      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated");
        return;
      }

      const errors: ConsoleError[] = [];
      const detach = collectConsoleErrors(page, errors);

      // Navigate within the app to trigger lazy modules
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 50));
      await page.waitForTimeout(300);

      detach();

      const filtered = filterIgnorableErrors(errors);
      expect(
        filtered,
        `Console errors on ${route.path}:\n${filtered.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`
      ).toHaveLength(0);
    });
  }
});

/* ──────────────────────────────────────────────────────── */
/*  PROTECTED OWNER PAGES — Console Errors                 */
/* ──────────────────────────────────────────────────────── */

test.describe("Console Errors — Owner Protected Pages", () => {
  const protectedOwnerRoutes = OWNER_ROUTES.filter((r) => !r.public);

  for (const route of protectedOwnerRoutes) {
    test(`Owner ${route.label} — no console errors`, async ({ page }) => {
      if (!hasOwnerCredentials()) {
        test.skip(true, "OWNER_USER + OWNER_PASS required");
        return;
      }

      await gotoProtectedOwner(page, route.path);

      if (page.url().includes("/owner/login")) {
        test.skip(true, "Owner not authenticated");
        return;
      }

      const errors: ConsoleError[] = [];
      const detach = collectConsoleErrors(page, errors);
      await page.waitForTimeout(800);
      await page.evaluate(() => window.scrollTo(0, 50));
      await page.waitForTimeout(300);
      detach();

      const filtered = filterIgnorableErrors(errors);
      expect(
        filtered,
        `Console errors on ${route.path}:\n${filtered.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`
      ).toHaveLength(0);
    });
  }
});

/* ──────────────────────────────────────────────────────── */
/*  NO ERROR OVERLAY                                       */
/* ──────────────────────────────────────────────────────── */

test.describe("No Angular Error Overlay", () => {
  for (const route of STAFF_ROUTES) {
    test(`${route.label} — no error overlay`, async ({ page }) => {
      if (!route.public && !hasStaffCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS required");
        return;
      }

      if (!route.public) {
        await gotoProtected(page, route.path);
        if (page.url().includes("/staff/login")) {
          test.skip(true, "Not authenticated");
          return;
        }
      } else {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(600);
      }

      expect(await hasErrorOverlay(page)).toBe(false);
    });
  }
});
