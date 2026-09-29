/**
 * Visual regression tests for key UI components.
 *
 * Covers: GiftCard (locked, unlocked, claimed states), CreateGiftForm, Navbar.
 * Snapshots are committed to e2e/visual/__snapshots__/.
 *
 * SNAPSHOT STABILITY (Issue #127)
 * ───────────────────────────────
 * All data used in these tests comes from `./fixtures.ts`, which provides:
 *  • Fixed IDs matching scripts/seed-test-db.ts (seed-gift-1, 2, 3)
 *  • Fixed timestamps anchored to VISUAL_SEED_EPOCH (2024-01-15T10:00:00Z)
 *  • Fixed exchange rates and NGN/USDC amounts
 *
 * The gift detail pages (e.g. /gifts/seed-gift-1) are mocked via
 * `page.route()` so the test does NOT require a live database. The mocked
 * response uses the exact same data as the DB seed so that:
 *   1. Snapshots match whether the test runs against a seeded DB or a mock.
 *   2. CI snapshots are reproducible because dates/amounts never change.
 *
 * Update snapshots: npm run test:visual:update
 * Review policy: any `.png` change in __snapshots__/ requires a PR review
 * (enforced via CODEOWNERS on e2e/visual/).
 *
 * Closes #107, #127
 */
import { test, expect, type Page } from "@playwright/test";
import {
  GIFT_LOCKED,
  GIFT_UNLOCKED,
  GIFT_CLAIMED,
  giftApiResponse,
  VISUAL_SEED_EPOCH,
} from "./fixtures";

// ─── Clock freeze ──────────────────────────────────────────────────────────────

/**
 * Freeze `Date.now()` and `new Date()` to the seed epoch so that any
 * "time since" or "time until" labels rendered by the UI are deterministic.
 *
 * Uses the Playwright `addInitScript` approach which runs before the page's
 * own JavaScript, so even module-level `new Date()` calls see the frozen time.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript((epoch: number) => {
    // Freeze Date constructor and Date.now
    const OriginalDate = Date;
    const frozenNow = epoch;

    class FrozenDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof OriginalDate>) {
        if (args.length === 0) {
          super(frozenNow);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
      static now(): number {
        return frozenNow;
      }
    }

    // @ts-expect-error — intentional runtime override for test determinism
    globalThis.Date = FrozenDate;
  }, VISUAL_SEED_EPOCH);
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

test("Navbar — visual snapshot", async ({ page }) => {
  await freezeClock(page);
  await page.goto("/");
  const navbar = page.locator("header");
  await expect(navbar).toHaveScreenshot("navbar.png");
});

// ─── CreateGiftForm ───────────────────────────────────────────────────────────

test("CreateGiftForm — visual snapshot", async ({ page }) => {
  await freezeClock(page);
  // Mock the session so the form renders in authenticated state if required
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "seed-user-1", phone: "+2348011111111" },
        expires: new Date(VISUAL_SEED_EPOCH + 86_400_000).toISOString(),
      }),
    })
  );
  await page.goto("/send");
  const form = page.locator("form");
  await expect(form).toHaveScreenshot("create-gift-form.png");
});

// ─── GiftCard states ──────────────────────────────────────────────────────────

/**
 * Gift detail pages are mocked via route interception.
 *
 * Why mock instead of hitting the live DB?
 *  • The mocked data is identical to what the seed script inserts, so the
 *    rendered output is the same regardless of whether the DB is seeded.
 *  • Mocking eliminates timing jitter from DB cold-starts in CI.
 *  • Fixed dates in the mock prevent "3 days ago" strings from drifting.
 *
 * See fixtures.ts for the exact data used.
 */

test("GiftCard — locked state", async ({ page }) => {
  await freezeClock(page);

  // Mock the API so the locked gift data is stable (seed-gift-1)
  await page.route(`**/api/v1/gifts/${GIFT_LOCKED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_LOCKED)),
    })
  );

  await page.goto(`/gifts/${GIFT_LOCKED.id}`);
  const card = page.locator("article").first();
  await expect(card).toHaveScreenshot("gift-card-locked.png");
});

test("GiftCard — unlocked state", async ({ page }) => {
  await freezeClock(page);

  // Mock the API so the unlocked gift data is stable (seed-gift-2)
  await page.route(`**/api/v1/gifts/${GIFT_UNLOCKED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_UNLOCKED)),
    })
  );

  await page.goto(`/gifts/${GIFT_UNLOCKED.id}`);
  const card = page.locator("article").first();
  await expect(card).toHaveScreenshot("gift-card-unlocked.png");
});

test("GiftCard — claimed state", async ({ page }) => {
  await freezeClock(page);

  // Mock the API so the claimed gift data is stable (seed-gift-3)
  await page.route(`**/api/v1/gifts/${GIFT_CLAIMED.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(giftApiResponse(GIFT_CLAIMED)),
    })
  );

  await page.goto(`/gifts/${GIFT_CLAIMED.id}`);
  const card = page.locator("article").first();
  await expect(card).toHaveScreenshot("gift-card-claimed.png");
});
