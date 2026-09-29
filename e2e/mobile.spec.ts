/**
 * e2e: Mobile viewport coverage
 *
 * Validates that all core user flows (login, gift-send, dashboard, claim)
 * remain visible and usable at narrow touch viewports (≤ 430 px wide).
 *
 * These tests run in the `mobile-chrome` (Pixel 5) and `mobile-safari`
 * (iPhone 12) Playwright projects defined in playwright.config.ts.
 *
 * Accessibility bar for mobile controls:
 *  • Buttons and inputs must be visible (not clipped or hidden off-screen).
 *  • Interactive elements must have a minimum effective height of 44 CSS px
 *    so they are reachable by a finger tap.
 *  • No horizontal scroll should be required (content fits in viewport width).
 *
 * All external services (OTP, Paystack, Stellar) are mocked so no real money
 * moves and no SMS is ever sent during testing.
 *
 * Failure artifacts (screenshots, videos, traces) are uploaded from CI via
 * the `upload-artifact` step in .github/workflows/ci.yml.
 *
 * Closes #125
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// ─── Constants ─────────────────────────────────────────────────────────────────

const TEST_PHONE = "+2348012345678";
const VALID_OTP = "123456";
const TEST_GIFT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CLAIM_GIFT_ID = "00000000-0000-0000-0000-000000000001";
const RECIPIENT_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Minimum recommended touch target height in CSS pixels (WCAG 2.5.5). */
const MIN_TOUCH_TARGET_PX = 44;

// ─── Mock helpers ──────────────────────────────────────────────────────────────

async function mockAuthSession(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "test-user-id", phone: TEST_PHONE },
        expires: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    })
  );
}

async function mockOtp(page: Page, { valid = true } = {}) {
  await page.route("**/api/auth/send-otp", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    })
  );
  await page.route("**/api/auth/signin/credentials", (route) =>
    route.fulfill({
      status: valid ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        valid ? { url: "/dashboard" } : { error: "Invalid OTP. Please try again." }
      ),
    })
  );
}

async function mockGiftsList(page: Page) {
  const gifts = [
    {
      id: "gift-locked-001",
      recipientName: "Alice",
      amountNgn: 5000,
      amountUsdc: "3.00",
      message: "Happy birthday!",
      status: "locked",
      unlockAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];
  await page.route("**/api/v1/gifts*", (route) => {
    const url = route.request().url();
    if (!url.match(/\/gifts\/[a-z0-9-]{10,}/)) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: gifts }),
      });
    } else {
      route.continue();
    }
  });
}

async function mockSendGift(page: Page) {
  const unlockAt = new Date(Date.now() + 86_400_000).toISOString();
  const mockGift = {
    id: TEST_GIFT_ID,
    senderId: "test-user-id",
    recipientPhone: TEST_PHONE,
    recipientName: "Test Recipient",
    amountNgn: 1000,
    amountUsdc: "0.5000000",
    message: "Happy testing!",
    unlockAt,
    status: "pending_payment",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const paymentUrl = `http://localhost:3000/api/payments/callback?reference=test_ref&giftId=${TEST_GIFT_ID}`;

  await page.route("**/api/gifts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { gift: mockGift, paymentUrl } }),
    })
  );
  await page.route("**/api/payments/callback*", (route) =>
    route.fulfill({
      status: 302,
      headers: { Location: `/gifts/${TEST_GIFT_ID}` },
    })
  );
  await page.route(`**/api/v1/gifts/${TEST_GIFT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { ...mockGift, status: "locked" } }),
    })
  );
}

async function mockClaimGift(page: Page, status: "locked" | "unlocked" | "claimed" = "unlocked") {
  await page.route(`**/api/v1/gifts/${CLAIM_GIFT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          id: CLAIM_GIFT_ID,
          recipientName: "Ada",
          amountNgn: 5000,
          amountUsdc: "3.00",
          message: "Happy birthday!",
          status,
          unlockAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
      }),
    })
  );
  await page.route(`**/api/v1/gifts/${CLAIM_GIFT_ID}/claim`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { txHash: "abc123txhash" } }),
    })
  );
}

// ─── Viewport helpers ──────────────────────────────────────────────────────────

/**
 * Asserts there is no horizontal overflow (no horizontal scrollbar needed).
 * This catches content that overflows the mobile viewport width.
 */
async function assertNoHorizontalScroll(page: Page) {
  const hasHScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(hasHScroll, "Page should not require horizontal scrolling on mobile").toBe(false);
}

/**
 * Returns the bounding box height of the first matching locator element.
 * Used to verify touch targets are large enough.
 */
async function getElementHeight(page: Page, selector: string): Promise<number | null> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  return box?.height ?? null;
}

// ─── §1  Login flow at mobile viewport ────────────────────────────────────────

test.describe("Mobile: Login flow", () => {
  test("login page renders controls without horizontal scroll", async ({ page }) => {
    await mockOtp(page);
    await page.goto("/login");
    await assertNoHorizontalScroll(page);
  });

  test("phone input and OTP send button are visible at mobile viewport", async ({ page }) => {
    await mockOtp(page);
    await page.goto("/login");

    const phoneInput = page.getByRole("textbox", { name: /phone/i });
    const sendButton = page.getByRole("button", { name: /send otp|get code|continue/i });

    await expect(phoneInput).toBeVisible();
    await expect(sendButton).toBeVisible();
  });

  test("send OTP button meets minimum touch-target height on mobile", async ({ page }) => {
    await mockOtp(page);
    await page.goto("/login");

    const height = await getElementHeight(page, 'button[type="submit"], button');
    if (height !== null) {
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  test("OTP input appears after submitting phone number on mobile", async ({ page }) => {
    await mockOtp(page);
    await page.goto("/login");

    await page.getByRole("textbox", { name: /phone/i }).fill(TEST_PHONE);
    await page.getByRole("button", { name: /send otp|get code|continue/i }).click();

    await expect(page.getByRole("textbox", { name: /otp|code|verification/i })).toBeVisible({
      timeout: 10_000,
    });
    await assertNoHorizontalScroll(page);
  });

  test("valid OTP redirects to dashboard on mobile", async ({ page }) => {
    await mockOtp(page, { valid: true });
    await page.goto("/login");

    await page.getByRole("textbox", { name: /phone/i }).fill(TEST_PHONE);
    await page.getByRole("button", { name: /send otp|get code|continue/i }).click();
    await page.getByRole("textbox", { name: /otp|code|verification/i }).fill(VALID_OTP);
    await page.getByRole("button", { name: /verify|confirm|sign in|submit/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });
});

// ─── §2  Gift send flow at mobile viewport ─────────────────────────────────────

test.describe("Mobile: Gift send flow", () => {
  test("send page renders without horizontal scroll", async ({ page }) => {
    await mockAuthSession(page);
    await mockSendGift(page);
    await page.goto("/send");
    await assertNoHorizontalScroll(page);
  });

  test("all gift form fields are visible at mobile viewport", async ({ page }) => {
    await mockAuthSession(page);
    await mockSendGift(page);
    await page.goto("/send");

    // All required inputs should be in the viewport (visible without scrolling)
    await expect(page.locator('input[name="recipientName"]')).toBeVisible();
    await expect(page.locator('input[name="recipientPhone"]')).toBeVisible();
    await expect(page.locator('input[name="amountNgn"]')).toBeVisible();
    await expect(page.locator('input[name="unlockAt"]')).toBeVisible();
  });

  test("submit button is visible and meets touch-target size on mobile", async ({ page }) => {
    await mockAuthSession(page);
    await mockSendGift(page);
    await page.goto("/send");

    const submitButton = page.locator('button[type="submit"]').first();
    await expect(submitButton).toBeVisible();

    const height = await getElementHeight(page, 'button[type="submit"]');
    if (height !== null) {
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  test("form validation errors are readable at mobile viewport", async ({ page }) => {
    await mockAuthSession(page);
    await mockSendGift(page);
    await page.goto("/send");

    // Submit empty form
    await page.locator('button[type="submit"]').first().click();

    // At least one validation error should be visible
    const errorLocator = page
      .getByText(/required|must be|enter a valid|minimum/i)
      .or(page.getByRole("alert"));
    await expect(errorLocator.first()).toBeVisible({ timeout: 10_000 });
    await assertNoHorizontalScroll(page);
  });
});

// ─── §3  Dashboard at mobile viewport ─────────────────────────────────────────

test.describe("Mobile: Dashboard", () => {
  test("dashboard renders without horizontal scroll", async ({ page }) => {
    await mockAuthSession(page);
    await mockGiftsList(page);
    await page.goto("/dashboard");
    await assertNoHorizontalScroll(page);
  });

  test("gift list items are visible on mobile", async ({ page }) => {
    await mockAuthSession(page);
    await mockGiftsList(page);
    await page.goto("/dashboard");

    // The gift card / list item for Alice should be visible
    await expect(page.getByText("Alice")).toBeVisible({ timeout: 10_000 });
  });

  test("Send a gift CTA button is visible and tappable on mobile", async ({ page }) => {
    await mockAuthSession(page);
    await mockGiftsList(page);
    await page.goto("/dashboard");

    const cta = page
      .getByRole("link", { name: /send a gift/i })
      .or(page.getByRole("button", { name: /send a gift/i }))
      .first();

    await expect(cta).toBeVisible({ timeout: 10_000 });

    const height = await getElementHeight(page, '[href="/send"], button');
    if (height !== null) {
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  test("navigation / header is visible and not clipped on mobile", async ({ page }) => {
    await mockAuthSession(page);
    await mockGiftsList(page);
    await page.goto("/dashboard");

    const header = page.locator("header, nav").first();
    await expect(header).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});

// ─── §4  Gift claim flow at mobile viewport ────────────────────────────────────

test.describe("Mobile: Gift claim flow", () => {
  const claimUrl = `/gifts/${CLAIM_GIFT_ID}?stellarKey=${RECIPIENT_KEY}`;

  test("claim page renders without horizontal scroll", async ({ page }) => {
    await mockClaimGift(page, "unlocked");
    await page.goto(claimUrl);
    await assertNoHorizontalScroll(page);
  });

  test("claim button is visible and meets touch-target size on unlocked gift", async ({ page }) => {
    await mockClaimGift(page, "unlocked");
    await page.goto(claimUrl);

    const claimButton = page.getByRole("button", { name: /claim gift/i });
    await expect(claimButton).toBeVisible({ timeout: 10_000 });

    const box = await claimButton.boundingBox();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  test("locked gift hides amount on mobile", async ({ page }) => {
    await mockClaimGift(page, "locked");
    await page.goto(claimUrl);

    await expect(page.getByText("₦ ••••••")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /claim gift/i })).not.toBeVisible();
  });

  test("successful claim completes on mobile viewport", async ({ page }) => {
    await mockClaimGift(page, "unlocked");

    // Override the claim API to also update gift state after claim
    let callCount = 0;
    await page.route(`**/api/v1/gifts/${CLAIM_GIFT_ID}`, (route) => {
      callCount++;
      const status = callCount === 1 ? "unlocked" : "claimed";
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: CLAIM_GIFT_ID,
            recipientName: "Ada",
            amountNgn: 5000,
            amountUsdc: "3.00",
            message: "Happy birthday!",
            status,
            unlockAt: new Date(Date.now() - 3_600_000).toISOString(),
          },
        }),
      });
    });

    await page.goto(claimUrl);
    await page.getByRole("button", { name: /claim gift/i }).click();

    await expect(page.getByRole("button", { name: /claim gift/i })).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
