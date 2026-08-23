/**
 * Shared test utilities for the Aura Staff App E2E suite.
 *
 * Pure functions — no Playwright imports except Page type.
 * Used by every spec file.
 */

import { type Page, type ConsoleMessage } from "@playwright/test";

/* ── Layout helpers ────────────────────────────────────── */

/** Returns true if document.documentElement has horizontal overflow. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
}

/** Returns the overflow amount in pixels. */
export async function horizontalOverflowPx(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

/* ── Element size helpers ──────────────────────────────── */

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Get bounding box of a single element, or null if hidden. */
export async function getElementRect(page: Page, selector: string): Promise<ElementRect | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || (el as HTMLElement).offsetParent === null) return null;
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

/** Get all interactive elements and their bounding rects. */
export async function getInteractiveElements(
  page: Page
): Promise<Array<{ tag: string; id: string; classes: string; rect: ElementRect }>> {
  return page.evaluate(() => {
    const sel =
      'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([disabled]), [role="link"], [role="tab"]';
    return Array.from(document.querySelectorAll(sel))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        return {
          tag: h.tagName.toLowerCase(),
          id: h.id,
          classes: (typeof h.className === "string" ? h.className : "").split(/\s+/).slice(0, 3).join(" "),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });
  });
}

/** Count interactive elements that are smaller than the given minimum size. */
export async function countUndersizedTargets(
  page: Page,
  minPx = 44
): Promise<Array<{ selector: string; width: number; height: number }>> {
  return page.evaluate((min) => {
    const sel =
      'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
    const issues: Array<{ selector: string; width: number; height: number }> = [];
    document.querySelectorAll(sel).forEach((el) => {
      const h = el as HTMLElement;
      if (h.offsetParent === null) return;
      const r = h.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.width < 16 && r.height < 16) return; // skip decorative
      if (r.width < min || r.height < min) {
        issues.push({
          selector: h.tagName.toLowerCase() + (h.id ? `#${h.id}` : "") + (typeof h.className === "string" && h.className ? `.${h.className.trim().split(/\s+/)[0]}` : ""),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      }
    });
    return issues;
  }, minPx);
}

/* ── Visibility helpers ────────────────────────────────── */

/** Check if a CSS selector's element is visible on screen. */
export async function isVisible(page: Page, selector: string): Promise<boolean> {
  const count = await page.locator(selector).count();
  if (count === 0) return false;
  const box = await page.locator(selector).first().boundingBox();
  return box !== null && box.height > 0 && box.width > 0;
}

/* ── Console error collector ───────────────────────────── */

export interface ConsoleError {
  type: string;
  text: string;
  url: string;
}

/**
 * Attach a console listener that collects JS errors.
 * Returns a detach function.
 */
export function collectConsoleErrors(page: Page, errors: ConsoleError[]): () => void {
  const handler = (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      errors.push({
        type: msg.type(),
        text: msg.text(),
        url: msg.location().url,
      });
    }
  };
  page.on("console", handler);
  return () => page.off("console", handler);
}

/** Filter out known-safe console messages (favicon 404s, third-party, expected API errors). */
export function filterIgnorableErrors(errors: ConsoleError[]): ConsoleError[] {
  const ignorable = [
    /favicon\.ico/,
    /Failed to load resource.*\.woff2/,
    /third.party/,
    /analytics/,
    /service.worker/i,
    /WebSocket/,
    /realtime\/ticket/,
    /auth\/refresh/,
    /overtime-summary/,
    /401.*Unauthorized/,
    /403.*Forbidden/,
    /400.*Bad Request/,
  ];
  return errors.filter((e) => !ignorable.some((p) => p.test(e.text) || p.test(e.url)));
}

/* ── Screenshot helpers ────────────────────────────────── */

/**
 * Stabilize a page before taking a screenshot:
 *   - Wait for network idle
 *   - Hide dynamic content (timestamps, counters)
 *   - Disable CSS animations
 */
export async function stabilizeForScreenshot(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});

  // Disable CSS animations and transitions
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });

  // Hide elements that contain dynamic timestamps or live data
  await page.evaluate(() => {
    const selectors = [
      ".net-status",
      ".queue-status",
      ".staff-toast",
      "[role='status']",
      ".staff-topbar time",
    ];
    selectors.forEach((s) => {
      document.querySelectorAll(s).forEach((el) => {
        (el as HTMLElement).style.visibility = "hidden";
      });
    });
  });

  // Settle rendering
  await page.waitForTimeout(200);
}

/* ── Navigation helpers ────────────────────────────────── */

/** Wait for Angular to finish route loading and rendering. */
export async function waitForAngularSettle(page: Page): Promise<void> {
  // Wait for network to be mostly idle
  await page.waitForLoadState("domcontentloaded");
  // Give Angular change detection time to run
  await page.waitForTimeout(500);
}

/**
 * Check if a page resulted in an Angular error overlay.
 */
export async function hasErrorOverlay(page: Page): Promise<boolean> {
  return page
    .locator("text=Application Error")
    .isVisible({ timeout: 300 })
    .catch(() => false);
}
