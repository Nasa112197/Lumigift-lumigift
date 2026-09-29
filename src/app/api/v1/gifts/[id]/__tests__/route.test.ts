/**
 * @jest-environment node
 *
 * Unit tests for:
 *   GET    /api/v1/gifts/[id]
 *   DELETE /api/v1/gifts/[id]
 *
 * Closes #117
 */

import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));

jest.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockGetGiftById = jest.fn();
const mockCancelGift = jest.fn();
const mockHashPhone = jest.fn((phone: string) => `hash-of-${phone}`);
jest.mock("@/server/services/gift.service", () => ({
  getGiftById: (...args: unknown[]) => mockGetGiftById(...args),
  cancelGift: (...args: unknown[]) => mockCancelGift(...args),
  hashPhone: (phone: string) => mockHashPhone(phone),
}));

const mockRefundPayment = jest.fn();
jest.mock("@/lib/paystack", () => ({
  refundPayment: (...args: unknown[]) => mockRefundPayment(...args),
}));

jest.mock("@/lib/csrf", () => ({
  withCsrf:
    (handler: (req: NextRequest, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) =>
      handler(req, ctx),
}));

jest.mock("@/lib/logger", () => ({
  requestLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
  getCorrelationId: () => "test-correlation-id",
  serviceLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));
jest.mock("@sentry/nextjs", () => ({
  withScope: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock("@/server/errors", () => ({
  mapError: (err: unknown) => ({
    publicMessage: err instanceof Error ? err.message : "Internal server error",
    code: "INTERNAL_ERROR",
    status: 500,
  }),
  AppError: class AppError extends Error {},
  ERROR_CODES: {},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SENDER_ID = "sender-999";
const RECIPIENT_PHONE = "+2348011223344";

const MOCK_GIFT = {
  id: "gift-xyz-456",
  senderId: SENDER_ID,
  recipientPhoneHash: `hash-of-${RECIPIENT_PHONE}`,
  recipientName: "Chioma Okafor",
  amountNgn: 10_000,
  amountUsdc: "6.2500000",
  message: "Happy Anniversary!",
  status: "locked" as const,
  unlockAt: new Date(Date.now() + 7 * 86_400_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeGET(id: string, headers: Record<string, string> = {}) {
  return [
    new NextRequest(`http://localhost/api/v1/gifts/${id}`, { headers }),
    { params: { id } },
  ] as const;
}

function makeDELETE(id: string, headers: Record<string, string> = {}) {
  return [
    new NextRequest(`http://localhost/api/v1/gifts/${id}`, { method: "DELETE", headers }),
    { params: { id } },
  ] as const;
}

// ─── GET /api/v1/gifts/[id] ───────────────────────────────────────────────────

describe("GET /api/v1/gifts/[id]", () => {
  let GET: (req: NextRequest, ctx: unknown) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGetServerSession.mockReset();
    mockGetGiftById.mockReset();
    mockHashPhone.mockImplementation((phone: string) => `hash-of-${phone}`);

    ({ GET } = await import("../route"));
  });

  it("returns 404 when gift does not exist", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockGetGiftById.mockResolvedValue(null);

    const [req, ctx] = makeGET("nonexistent-id");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns public fields only for unauthenticated user", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeGET(MOCK_GIFT.id);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Public fields
    expect(body.data.id).toBe(MOCK_GIFT.id);
    expect(body.data.status).toBe("locked");
    // Private fields must NOT be exposed
    expect(body.data.senderId).toBeUndefined();
    expect(body.data.recipientPhoneHash).toBeUndefined();
  });

  it("returns public fields for an unrelated authenticated user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "different-user", phone: "+2340000000000" } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeGET(MOCK_GIFT.id);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.senderId).toBeUndefined();
  });

  it("returns full gift (minus phone hash) for the sender", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeGET(MOCK_GIFT.id);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.senderId).toBe(SENDER_ID);
    expect(body.data.amountNgn).toBe(10_000);
    // Phone hash must be stripped from full response
    expect(body.data.recipientPhoneHash).toBeUndefined();
  });

  it("returns full gift for the recipient (by phone hash)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "other-user", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeGET(MOCK_GIFT.id);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.amountNgn).toBe(10_000);
    expect(body.data.recipientPhoneHash).toBeUndefined();
  });
});

// ─── DELETE /api/v1/gifts/[id] ────────────────────────────────────────────────

describe("DELETE /api/v1/gifts/[id]", () => {
  let DELETE: (req: NextRequest, ctx: unknown) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGetServerSession.mockReset();
    mockGetGiftById.mockReset();
    mockCancelGift.mockReset();
    mockRefundPayment.mockReset();
    mockHashPhone.mockImplementation((phone: string) => `hash-of-${phone}`);

    ({ DELETE } = await import("../route"));
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const [req, ctx] = makeDELETE("gift-xyz-456");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when gift does not exist", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue(null);

    const [req, ctx] = makeDELETE("no-such-gift");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when requester is not the sender", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "interloper-user" } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeDELETE(MOCK_GIFT.id);
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 409 when gift is not in a cancellable state", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue({ ...MOCK_GIFT, status: "claimed" });

    const [req, ctx] = makeDELETE(MOCK_GIFT.id);
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/cannot be cancelled/i);
  });

  it("returns 409 when the unlock date has already passed", async () => {
    const pastUnlock = new Date(Date.now() - 1000);
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue({ ...MOCK_GIFT, status: "locked", unlockAt: pastUnlock });

    const [req, ctx] = makeDELETE(MOCK_GIFT.id);
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/unlock time has already passed/i);
  });

  it("cancels the gift and triggers a Paystack refund", async () => {
    const futureUnlock = new Date(Date.now() + 86_400_000);
    const giftToDelete = { ...MOCK_GIFT, status: "locked" as const, unlockAt: futureUnlock };
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue(giftToDelete);
    mockRefundPayment.mockResolvedValue(undefined);
    mockCancelGift.mockResolvedValue({ ...giftToDelete, status: "cancelled" });

    const [req, ctx] = makeDELETE(MOCK_GIFT.id);
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("cancelled");
    expect(mockRefundPayment).toHaveBeenCalledWith(`lumigift_${MOCK_GIFT.id}`);
    expect(mockCancelGift).toHaveBeenCalledWith(MOCK_GIFT.id);
  });

  it("also cancels gifts in 'pending_payment' state", async () => {
    const futureUnlock = new Date(Date.now() + 86_400_000);
    const pendingGift = { ...MOCK_GIFT, status: "pending_payment" as const, unlockAt: futureUnlock };
    mockGetServerSession.mockResolvedValue({ user: { id: SENDER_ID } });
    mockGetGiftById.mockResolvedValue(pendingGift);
    mockRefundPayment.mockResolvedValue(undefined);
    mockCancelGift.mockResolvedValue({ ...pendingGift, status: "cancelled" });

    const [req, ctx] = makeDELETE(MOCK_GIFT.id);
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
  });
});
