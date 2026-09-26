/**
 * @jest-environment node
 *
 * Unit tests for payment-reconciliation.service.ts (Issue #60)
 *
 * Mocks:
 *  - @/lib/paystack      → verifyPayment
 *  - @/lib/redis         → getRedisClient (full mock with set/get/del/sAdd/sIsMember/sRem/sMembers)
 *  - ./gift.service      → getGiftsByStatus, updateGiftStatusIdempotent
 *
 * Covers:
 *  - Pending gifts recovered on Paystack success
 *  - Failed Paystack payments leave gift in pending_payment
 *  - Still-pending payments increment retry counter
 *  - Gifts exceeding MAX_RETRIES are dead-lettered
 *  - Dead-lettered gifts are skipped in subsequent runs
 *  - Distributed lock prevents overlapping runs
 *  - Reconciliation never advances an invalid gift state
 *  - redriveDeadLetteredGift clears counter and dead-letter entry
 */

import type { Gift } from "@/types";

// ─── Redis mock ───────────────────────────────────────────────────────────────

// Must be declared before jest.mock factories run (hoisting).
// eslint-disable-next-line prefer-const
let redisMock: {
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  sAdd: jest.Mock;
  sRem: jest.Mock;
  sMembers: jest.Mock;
  sIsMember: jest.Mock;
};

jest.mock("@/lib/redis", () => {
  const mock = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sIsMember: jest.fn(),
  };
  // Assign to the outer-scoped variable so tests can access it
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (global as unknown as Record<string, unknown>).__redisMock = mock;
  return { getRedisClient: jest.fn(() => Promise.resolve(mock)) };
});

// ─── Paystack mock ────────────────────────────────────────────────────────────

jest.mock("@/lib/paystack", () => ({
  verifyPayment: jest.fn(),
}));

// ─── Gift service mock ────────────────────────────────────────────────────────

jest.mock("../gift.service", () => ({
  getGiftsByStatus: jest.fn(),
  updateGiftStatusIdempotent: jest.fn(),
}));

// ─── Logger mock (suppress output) ───────────────────────────────────────────

jest.mock("@/lib/logger", () => ({
  serviceLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  reconcilePendingPayments,
  getDeadLetteredGiftIds,
  redriveDeadLetteredGift,
  MAX_RETRIES,
} from "../payment-reconciliation.service";
import { verifyPayment } from "@/lib/paystack";
import { getGiftsByStatus, updateGiftStatusIdempotent } from "../gift.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGift(id: string, overrides: Partial<Gift> = {}): Gift {
  return {
    id,
    senderId: "sender-1",
    recipientPhoneHash: "abc123",
    recipientName: "Test User",
    amountNgn: 5000,
    amountUsdc: "3.0000000",
    unlockAt: new Date(Date.now() + 86_400_000),
    status: "pending_payment",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Retrieve the mock instance set by the jest.mock factory
  redisMock = (global as unknown as Record<string, typeof redisMock>).__redisMock;

  // Default: lock acquisition succeeds (NX set returns "OK")
  redisMock.set.mockResolvedValue("OK");
  redisMock.get.mockResolvedValue(null); // no prior retries
  redisMock.del.mockResolvedValue(1);
  redisMock.sAdd.mockResolvedValue(1);
  redisMock.sRem.mockResolvedValue(1);
  redisMock.sMembers.mockResolvedValue([]);
  redisMock.sIsMember.mockResolvedValue(false); // not dead-lettered by default

  (getGiftsByStatus as jest.Mock).mockResolvedValue([]);
  (updateGiftStatusIdempotent as jest.Mock).mockResolvedValue({ status: "locked" });
});

// ─── reconcilePendingPayments ─────────────────────────────────────────────────

describe("reconcilePendingPayments", () => {
  it("returns zero counts when there are no pending gifts", async () => {
    (getGiftsByStatus as jest.Mock).mockResolvedValue([]);
    const result = await reconcilePendingPayments();
    expect(result.inspected).toBe(0);
    expect(result.recovered).toBe(0);
  });

  it("skips run when distributed lock is already held", async () => {
    // NX set returns null when key already exists
    redisMock.set.mockResolvedValue(null);
    const result = await reconcilePendingPayments();
    expect(result.inspected).toBe(0);
    expect(getGiftsByStatus).not.toHaveBeenCalled();
  });

  it("releases the distributed lock after a successful run", async () => {
    (getGiftsByStatus as jest.Mock).mockResolvedValue([]);
    await reconcilePendingPayments();
    expect(redisMock.del).toHaveBeenCalledWith("reconcile:run-lock");
  });

  it("releases the distributed lock even when a gift throws", async () => {
    const gift = makeGift("gift-error-1");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    (verifyPayment as jest.Mock).mockRejectedValue(new Error("Paystack timeout"));
    const result = await reconcilePendingPayments();
    expect(redisMock.del).toHaveBeenCalledWith("reconcile:run-lock");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].giftId).toBe("gift-error-1");
  });

  it("increments recovered count when Paystack reports success", async () => {
    const gift = makeGift("gift-success-1");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    (verifyPayment as jest.Mock).mockResolvedValue({ status: "success" });
    const result = await reconcilePendingPayments();
    expect(result.recovered).toBe(1);
    expect(updateGiftStatusIdempotent).toHaveBeenCalledWith("gift-success-1", "locked");
  });

  it("increments failed count when Paystack reports failure", async () => {
    const gift = makeGift("gift-failed-1");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    (verifyPayment as jest.Mock).mockResolvedValue({ status: "failed" });
    const result = await reconcilePendingPayments();
    expect(result.failed).toBe(1);
    expect(updateGiftStatusIdempotent).not.toHaveBeenCalled();
  });

  it("increments pending count when Paystack still shows pending", async () => {
    const gift = makeGift("gift-pending-1");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    (verifyPayment as jest.Mock).mockResolvedValue({ status: "pending" });
    const result = await reconcilePendingPayments();
    expect(result.pending).toBe(1);
    expect(updateGiftStatusIdempotent).not.toHaveBeenCalled();
  });

  it("dead-letters a gift after MAX_RETRIES are exceeded", async () => {
    const gift = makeGift("gift-dead-1");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    redisMock.get.mockResolvedValue(String(MAX_RETRIES)); // already at limit
    const result = await reconcilePendingPayments();
    expect(result.deadLettered).toBe(1);
    expect(redisMock.sAdd).toHaveBeenCalledWith("reconcile:dead-letter", "gift-dead-1");
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it("skips gifts that are already dead-lettered", async () => {
    const gift = makeGift("gift-dead-2");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([gift]);
    redisMock.sIsMember.mockResolvedValue(true); // already in dead-letter set
    const result = await reconcilePendingPayments();
    expect(result.inspected).toBe(1);
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(result.deadLettered).toBe(0);
  });

  it("does not call updateGiftStatusIdempotent for non-success statuses", async () => {
    const g1 = makeGift("g1");
    const g2 = makeGift("g2");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([g1, g2]);
    (verifyPayment as jest.Mock)
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "pending" });
    await reconcilePendingPayments();
    expect(updateGiftStatusIdempotent).not.toHaveBeenCalled();
  });

  it("processes multiple gifts correctly", async () => {
    const g1 = makeGift("g1");
    const g2 = makeGift("g2");
    const g3 = makeGift("g3");
    (getGiftsByStatus as jest.Mock).mockResolvedValue([g1, g2, g3]);
    (verifyPayment as jest.Mock)
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "pending" });
    const result = await reconcilePendingPayments();
    expect(result.inspected).toBe(3);
    expect(result.recovered).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
  });
});

// ─── getDeadLetteredGiftIds ───────────────────────────────────────────────────

describe("getDeadLetteredGiftIds", () => {
  it("returns the contents of the dead-letter set", async () => {
    redisMock.sMembers.mockResolvedValue(["gift-a", "gift-b"]);
    const ids = await getDeadLetteredGiftIds();
    expect(ids).toEqual(["gift-a", "gift-b"]);
  });
});

// ─── redriveDeadLetteredGift ──────────────────────────────────────────────────

describe("redriveDeadLetteredGift", () => {
  it("removes the gift from the dead-letter set", async () => {
    await redriveDeadLetteredGift("gift-recover-1");
    expect(redisMock.sRem).toHaveBeenCalledWith("reconcile:dead-letter", "gift-recover-1");
  });

  it("clears the retry counter for the gift", async () => {
    await redriveDeadLetteredGift("gift-recover-1");
    expect(redisMock.del).toHaveBeenCalledWith("reconcile:retries:gift-recover-1");
  });
});
