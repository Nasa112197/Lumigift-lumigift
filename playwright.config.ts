import { defineConfig, devices } from "@playwright/test";

/**
 * Main Playwright configuration.
 *
 * Projects defined here:
 *   Desktop browsers (Issue #126 — cross-browser coverage):
 *     • chromium   — Desktop Chrome
 *     • firefox    — Desktop Firefox
 *     • webkit     — Desktop Safari (WebKit)
 *
 *   Mobile viewports (Issue #125 — mobile viewport coverage):
 *     • mobile-chrome   — Pixel 5 (Android / Chromium)
 *     • mobile-safari   — iPhone 12 (iOS / WebKit)
 *
 * All projects run through Playwright route-interception mocks so no real
 * money ever moves and no live external services are contacted.
 *
 * Browser failure triage
 * ──────────────────────
 * When a test fails on a specific browser/device project:
 *  1. Check the HTML report (`playwright-report/`) — filter by project name.
 *  2. Inspect the attached screenshots / video for the failing step.
 *  3. Read the trace file (open with `npx playwright show-trace`).
 *  4. Common browser-specific issues:
 *     - Firefox: CSS `backdrop-filter` not supported without a flag → visual only
 *     - WebKit/Safari: date-input format differences (YYYY-MM-DD vs MM/DD/YYYY)
 *     - Mobile: touch events, viewport meta, font-size scaling
 *  5. If a browser fails consistently but others pass, open a triage issue
 *     tagged `browser:<name>` and add a `test.skip` with a link to that issue.
 *
 * Closes #125, #126
 */
export default defineConfig({
  testDir: "./e2e",
  // Exclude visual regression tests — those run under playwright.visual.config.ts
  testIgnore: ["**/visual/**"],
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  // Limit parallel workers on CI to avoid flakiness from resource contention
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        // JSON reporter lets the upload step enumerate failures by project
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // Capture screenshot and video on failure for easier CI debugging
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // ── Desktop browsers (Issue #126 — cross-browser) ──────────────────────

    {
      /**
       * Chromium — Desktop Chrome
       * Primary browser; all new tests should pass here first.
       */
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      /**
       * Firefox — Desktop Firefox
       * Issue #126: triage tag `browser:firefox`
       * Known gap: CSS `backdrop-filter` is off by default (bug 1578503).
       * Functional tests should still pass; visual tests run separately.
       */
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      /**
       * WebKit — Desktop Safari
       * Issue #126: triage tag `browser:webkit`
       * Known gap: date/time input UI differs from Chrome; tests use .fill()
       * with ISO-format strings so this is handled.
       */
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },

    // ── Mobile viewports (Issue #125 — narrow touch viewports) ────────────

    {
      /**
       * Pixel 5 — Android Chrome (375 × 851, deviceScaleFactor 2.625)
       * Issue #125: triage tag `viewport:mobile-chrome`
       * Validates that touch targets are ≥ 44px and controls remain visible.
       */
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      /**
       * iPhone 12 — iOS Safari (390 × 844, deviceScaleFactor 3)
       * Issue #125: triage tag `viewport:mobile-safari`
       * Validates iOS-specific layout (safe-area insets, tap highlights).
       */
      name: "mobile-safari",
      use: { ...devices["iPhone 12"] },
    },
  ],
  // In CI the build has already run; start the production server.
  // Locally, reuse whatever is already running (dev or prod).
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Pipe server output to the test runner so failures are easier to diagnose
    stdout: "pipe",
    stderr: "pipe",
  },
});
