import { defineConfig, devices } from "@playwright/test";

/**
 * Aura Staff App — Playwright E2E & Mobile Viewport Test Suite
 *
 * Tests responsive layout, touch targets, console errors, network resilience,
 * screenshot regression, and orientation behavior across 10 device profiles.
 *
 * Prerequisites:
 *   Backend  → http://127.0.0.1:4000  (npm run api)
 *   Frontend → http://127.0.0.1:4320  (npm run staff)
 *
 * Environment variables:
 *   BASE_URL     — app origin       (default http://127.0.0.1:4320)
 *   STAFF_USER   — staff login ID
 *   STAFF_PASS   — staff password
 *   STAFF_TENANT — tenant ID        (default tenant_aura)
 */

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4320";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixelRatio: 0.015 } },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report", outputFile: "index.html" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    /* Disable animations for deterministic screenshots */
    launchOptions: { args: ["--disable-animations"] },
  },
  outputDir: "./e2e/test-results",
  snapshotPathTemplate: "{testDir}/screenshots/{projectName}/{arg}{ext}",
  projects: [
    /* ── Small phones ─────────────────────── */
    {
      name: "pixel-4",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 640 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["Pixel 4"].userAgent,
        deviceScaleFactor: 2.625,
      },
    },
    {
      name: "iphone-se",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["iPhone SE"].userAgent,
        deviceScaleFactor: 2,
      },
    },
    /* ── Standard phones ──────────────────── */
    {
      name: "pixel-7",
      use: {
        browserName: "chromium",
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["Pixel 7"].userAgent,
        deviceScaleFactor: 2.625,
      },
    },
    {
      name: "iphone-14",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["iPhone 14"].userAgent,
        deviceScaleFactor: 3,
      },
    },
    /* ── Large phones ─────────────────────── */
    {
      name: "pixel-8-pro",
      use: {
        browserName: "chromium",
        viewport: { width: 430, height: 932 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["Pixel 8 Pro"].userAgent,
        deviceScaleFactor: 3.5,
      },
    },
    {
      name: "iphone-15-pro-max",
      use: {
        browserName: "chromium",
        viewport: { width: 430, height: 932 },
        isMobile: true,
        hasTouch: true,
        userAgent: devices["iPhone 15 Pro Max"].userAgent,
        deviceScaleFactor: 3,
      },
    },
    /* ── Tablets ──────────────────────────── */
    {
      name: "ipad",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        isMobile: false,
        hasTouch: true,
        userAgent: devices["iPad (gen 7)"].userAgent,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "ipad-pro",
      use: {
        browserName: "chromium",
        viewport: { width: 1024, height: 1366 },
        isMobile: false,
        hasTouch: true,
        userAgent: devices["iPad Pro 11"].userAgent,
        deviceScaleFactor: 2,
      },
    },
    /* ── Desktop ──────────────────────────── */
    {
      name: "desktop-1280",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
        isMobile: false,
        hasTouch: false,
        userAgent: devices["Desktop Chrome"].userAgent,
      },
    },
    {
      name: "desktop-1920",
      use: {
        browserName: "chromium",
        viewport: { width: 1920, height: 1080 },
        isMobile: false,
        hasTouch: false,
        userAgent: devices["Desktop Chrome"].userAgent,
      },
    },
  ],
});
