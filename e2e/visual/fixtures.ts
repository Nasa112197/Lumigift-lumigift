/**
 * Visual test fixtures — deterministic data for snapshot stability.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Playwright `toHaveScreenshot` compares pixel-by-pixel against a committed
 * baseline.  Any change in displayed content — a different date, amount, or
 * ID — causes every snapshot to fail in CI even if the UI itself is unchanged.
 *
 * This file supplies:
 *  • Fixed gift IDs that match the seed script (scripts/seed-test-db.ts)
 *  • Fixed ISO timestamps expressed as UNIX epoch offsets from a pinned
 *    reference date (2024-01-15T10:00:00.000Z) so they never change
 *  • Fixed exchange rate and amounts matching the seed data
 *  • A `VISUAL_SEED_DATE` constant that is injected as `Date.now()` mock
 *    when snapshot tests need to freeze the clock
 *
 * ADDING NEW FIXTURES
 * ───────────────────
 * 1. Add your record below with a stable ID and a date offset from
 *    VISUAL_SEED_EPOCH (do not use `Date.now()` or `new Date()`).
 * 2. Add the record to scripts/seed-test-db.ts with the same ID.
 * 3. Run `npm run test:visual:update` locally to generate the baseline PNG.
 * 4. Commit both the fixture change AND the updated PNG in the same PR.
 *    CI will reject snapshot changes that aren't accompanied by a PR review.
 *
 * SNAPSHOT REVIEW POLICY (Closes #127)
 * ──────────────────────────────────────
 * Updated `.png` files in `e2e/visual/__snapshots__/` must be reviewed by
 * at least one team member before merging.  The CODEOWNERS file enforces
 * this for the `e2e/visual/` directory.
 *
 * Closes #127
 */

// ─── Reference epoch ──────────────────────────────────────────────────────────

/**
 * Pinned reference date for all visual fixtures.
 * This value MUST NOT be changed once snapshots are generated.
 * To update it: delete all snapshots, regenerate with --update-snapshots,
 * and open a PR with the new baseline images.
 */
export const VISUAL_SEED_EPOCH = new Date("2024-01-15T10:00:00.000Z").getTime();

/**
 * Convenience helpers for expressing dates relative to the seed epoch.
 * These match the offsets used in scripts/seed-test-db.ts.
 */
export const seedDate = {
  /** Returns a Date exactly `days` days before the seed epoch. */
  past: (days: number): Date => new Date(VISUAL_SEED_EPOCH - days * 86_400_000),
  /** Returns a Date exactly `days` days after the seed epoch. */
  future: (days: number): Date => new Date(VISUAL_SEED_EPOCH + days * 86_400_000),
  /** The seed epoch itself as a Date object. */
  now: (): Date => new Date(VISUAL_SEED_EPOCH),
};

// ─── Exchange rate ────────────────────────────────────────────────────────────

/**
 * Fixed NGN/USDC rate for visual tests.
 * Matches: 5000 NGN = 3.0000000 USDC  (i.e. 1 USDC = 1666.666… NGN ≈ 1667).
 * We use this rate consistently across all visual fixtures.
 */
export const VISUAL_NGN_PER_USDC = 1667;

// ─── User fixtures ────────────────────────────────────────────────────────────

/**
 * Deterministic users — IDs match scripts/seed-test-db.ts.
 * Phones and display names are stable; never use `faker` or random values here.
 */
export const VISUAL_USERS = {
  alice: {
    id: "seed-user-1",
    phone: "+2348011111111",
    displayName: "Alice Obi",
  },
  bob: {
    id: "seed-user-2",
    phone: "+2348022222222",
    displayName: "Bob Eze",
  },
  carol: {
    id: "seed-user-3",
    phone: "+2348033333333",
    displayName: "Carol Nwosu",
  },
} as const;

// ─── Gift fixtures ────────────────────────────────────────────────────────────

/**
 * Gift fixture type — mirrors the shape returned by GET /api/v1/gifts/:id.
 */
export interface GiftFixture {
  id: string;
  senderId: string;
  recipientName: string;
  recipientPhone: string;
  amountNgn: number;
  amountUsdc: string;
  message: string;
  status: "pending_payment" | "locked" | "unlocked" | "claimed";
  unlockAt: string; // ISO-8601
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  stellarTxHash?: string;
  claimTxHash?: string;
}

/**
 * Locked gift — seed-gift-1
 * Status: locked; unlocks 7 days after the seed epoch.
 * Amount hidden in UI; claim button not visible.
 */
export const GIFT_LOCKED: GiftFixture = {
  id: "seed-gift-1",
  senderId: VISUAL_USERS.alice.id,
  recipientName: VISUAL_USERS.bob.displayName,
  recipientPhone: VISUAL_USERS.bob.phone,
  amountNgn: 5000,
  amountUsdc: "3.0000000",
  message: "Happy birthday, Bob! Don't peek until the day! 🎂",
  status: "locked",
  unlockAt: seedDate.future(7).toISOString(),
  createdAt: seedDate.past(1).toISOString(),
  updatedAt: seedDate.past(1).toISOString(),
  stellarTxHash: "stellar_tx_locked_00000000000000000000000000000001",
} as const;

/**
 * Unlocked gift — seed-gift-2
 * Status: unlocked; unlock date is 1 day before the seed epoch.
 * Amount visible; claim button visible.
 */
export const GIFT_UNLOCKED: GiftFixture = {
  id: "seed-gift-2",
  senderId: VISUAL_USERS.alice.id,
  recipientName: VISUAL_USERS.carol.displayName,
  recipientPhone: VISUAL_USERS.carol.phone,
  amountNgn: 10000,
  amountUsdc: "6.0000000",
  message: "Congratulations on your graduation, Carol! 🎓",
  status: "unlocked",
  unlockAt: seedDate.past(1).toISOString(),
  createdAt: seedDate.past(8).toISOString(),
  updatedAt: seedDate.past(1).toISOString(),
  stellarTxHash: "stellar_tx_unlocked_0000000000000000000000000000002",
} as const;

/**
 * Claimed gift — seed-gift-3
 * Status: claimed; claimed 3 days before the seed epoch.
 * Claim button not shown; tx hash visible.
 */
export const GIFT_CLAIMED: GiftFixture = {
  id: "seed-gift-3",
  senderId: VISUAL_USERS.bob.id,
  recipientName: VISUAL_USERS.alice.displayName,
  recipientPhone: VISUAL_USERS.alice.phone,
  amountNgn: 2500,
  amountUsdc: "1.5000000",
  message: "Happy New Year, Alice! 🎉",
  status: "claimed",
  unlockAt: seedDate.past(3).toISOString(),
  createdAt: seedDate.past(10).toISOString(),
  updatedAt: seedDate.past(3).toISOString(),
  stellarTxHash: "stellar_tx_claimed_000000000000000000000000000003",
  claimTxHash: "claimtxhash0000000000000000000000000000000000000000000000000001",
} as const;

// ─── All fixtures for iteration ───────────────────────────────────────────────

/** Array of all gift fixtures, in order locked → unlocked → claimed. */
export const ALL_GIFT_FIXTURES: readonly GiftFixture[] = [
  GIFT_LOCKED,
  GIFT_UNLOCKED,
  GIFT_CLAIMED,
] as const;

// ─── Mock response helpers ────────────────────────────────────────────────────

/**
 * Returns the standard API success envelope for a single gift fixture.
 * Use with Playwright `page.route()` to mock GET /api/v1/gifts/:id.
 *
 * @example
 * await page.route(`**\/api/v1/gifts/seed-gift-1`, route =>
 *   route.fulfill({ status: 200, contentType: 'application/json',
 *     body: JSON.stringify(giftApiResponse(GIFT_LOCKED)) })
 * );
 */
export function giftApiResponse(gift: GiftFixture): { success: true; data: GiftFixture } {
  return { success: true, data: gift };
}

/**
 * Returns the standard API success envelope for a list of gift fixtures.
 */
export function giftsListApiResponse(gifts: readonly GiftFixture[]): {
  success: true;
  data: readonly GiftFixture[];
} {
  return { success: true, data: gifts };
}
