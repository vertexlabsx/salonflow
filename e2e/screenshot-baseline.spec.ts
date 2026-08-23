/**
 * Screenshot Regression Tests
 *
 * Captures full-page screenshots of every route at every viewport.
 * First run creates baselines; subsequent runs compare against them.
 *
 * Usage:
 *   npx playwright test screenshot-baseline                                  # compare
 *   npx playwright test screenshot-baseline --update-snapshots               # update baselines
 *   npx playwright test screenshot-baseline --project=pixel-7                # single device
 */

import { test, expect } from "@playwright/test";
import {
  hasStaffCredentials,
  hasOwnerCredentials,
  gotoProtected,
  gotoProtectedOwner,
  loginOwner,
} from "./fixtures/auth.helper";
import {
  stabilizeForScreenshot,
  hasErrorOverlay,
  waitForAngularSettle,
} from "./fixtures/helpers";
import { STAFF_ROUTES, OWNER_ROUTES } from "./fixtures/routes";

/* ──────────────────────────────────────────────────────── */
/*  Public Pages                                           */
/* ──────────────────────────────────────────────────────── */

test.describe("Screenshots — Public Pages", () => {
  test("staff login", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "networkidle" });
    await stabilizeForScreenshot(page);
    await expect(page).toHaveScreenshot("staff-login.png", { fullPage: true });
  });

  test("owner login", async ({ page }) => {
    await page.goto("/owner/login", { waitUntil: "networkidle" });
    await stabilizeForScreenshot(page);
    await expect(page).toHaveScreenshot("owner-login.png", { fullPage: true });
  });
});

/* ──────────────────────────────────────────────────────── */
/*  Protected Staff Pages                                  */
/* ──────────────────────────────────────────────────────── */

test.describe("Screenshots — Staff Pages", () => {
  const protectedRoutes = STAFF_ROUTES.filter((r) => !r.public);

  for (const route of protectedRoutes) {
    const screenshotName = route.path.replace(/\//g, "-").replace(/^-/, "");

    test(`staff ${route.label}`, async ({ page }) => {
      if (!hasStaffCredentials()) {
        test.skip(true, "STAFF_USER + STAFF_PASS required");
        return;
      }

      await gotoProtected(page, route.path);

      if (page.url().includes("/staff/login")) {
        test.skip(true, "Not authenticated");
        return;
      }

      // Wait for Angular to settle
      await waitForAngularSettle(page);

      // Dismiss any toast that might appear
      const toast = page.locator(".staff-toast");
      if ((await toast.isVisible({ timeout: 300 }).catch(() => false))) {
        await toast.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
      }

      await stabilizeForScreenshot(page);
      expect(await hasErrorOverlay(page)).toBe(false);

      await expect(page).toHaveScreenshot(`${screenshotName}.png`, { fullPage: true });
    });
  }
});

/* ──────────────────────────────────────────────────────── */
/*  Owner Pages                                            */
/* ──────────────────────────────────────────────────────── */

test.describe("Screenshots — Owner Pages", () => {
  const protectedRoutes = OWNER_ROUTES.filter((r) => !r.public);

  for (const route of protectedRoutes) {
    const screenshotName = "owner-" + route.path.replace(/\/owner\//, "").replace(/\//g, "-");

    test(`owner ${route.label}`, async ({ page }) => {
      if (!hasOwnerCredentials()) {
        test.skip(true, "OWNER_USER + OWNER_PASS required");
        return;
      }

      await gotoProtectedOwner(page, route.path);

      // If redirected to owner login, skip
      if (page.url().includes("/owner/login")) {
        test.skip(true, "Owner auth failed");
        return;
      }

      await waitForAngularSettle(page);
      await stabilizeForScreenshot(page);
      await expect(page).toHaveScreenshot(`${screenshotName}.png`, { fullPage: true });
    });
  }
});
