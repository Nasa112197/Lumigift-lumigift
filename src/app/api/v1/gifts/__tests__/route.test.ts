/**
 * @jest-environment node
 *
 * Unit tests for:
 *   GET  /api/v1/gifts
 *   POST /api/v1/gifts
 *
 * Closes #117
 */

import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));

jest.mock("@/lib/auth", () => ({ authOptions: {} }));

// Gift service — we test the route handler in isolation
const mockCreateGift = jest.fn();
const mockGetGiftsBySenderPaginated = jest.fn();
const mockGetGiftsBySenderPage = jest.fn();
jest.mock("@/server/services/gift.service", () => ({
  createGift: (...args: unknown[]) => mockCreateGift(...args),
  getGiftsBySenderPaginated: (...args: unknown[]) => mockGetGiftsBySenderPaginated(...args),
  getGiftsBySenderPage: (...args: unknown[]) => mockGetGiftsBySenderPage(...args),
}));

// Idempotency — default to "no key supplied"
const mockCheckIdempotencyKey = jest.fn();
const mockStoreIdempotencyResponse = jest.fn();
jest.mock("@/server/idempotency", () => ({
  checkIdempotencyKey: (...args: unknown[]) => mockCheckIdempotencyKey(...args),
  storeIdempotencyResponse: (...args: unknown[]) => mockStoreIdempotencyResponse(...args),
  IDEMPOTENCY_KEY_HEADER: "idempotency-key",
}));

// CSRF — pass-through in unit tests
jest.mock("@/lib/csrf", () => ({
  withCsrf:
    (handler: (req: NextRequest, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) =>
      handler(req, ctx),
}));

// Logger / Sentry — suppress output
jest.mock("@/lib/logger", () => ({
  requestLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
  getCorrelationId: () => "test-correlation-id",
  serviceLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
}));
jest.mock("@sentry/nextjs", () => ({
  withScope: jest.fn(),
  captureException: jest.fn(),
}));

// server/errors — minimal pass-through
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

function makeGET(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "GET", headers });
}

function makePOST(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/gifts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const SESSION_USER = { id: "user-123", phone: "+2348012345678" };

const VALID_GIFT_BODY = {
  recipientPhone: "+2348099887766",
  recipientName: "Tunde Bakare",
  amountNgn: 5000,
  message: "Happy birthday!",
  unlockAt: new Date(Date.now() + 86_400_000).toISOString(),
  paymentProvider: "paystack",
  recipientIsRegistered: true,
};

const MOCK_GIFT = {
  id: "gift-abc-123",
  senderId: "user-123",
  recipientPhoneHash: "deadbeef".repeat(8),
  recipientName: "Tunde Bakare",
  amountNgn: 5000,
  amountUsdc: "3.1250000",
  status: "pending_payment",
  unlockAt: new Date(Date.now() + 86_400_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── GET /api/v1/gifts ────────────────────────────────────────────────────────

describe("GET /api/v1/gifts", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGetServerSession.mockReset();
    mockGetGiftsBySenderPaginated.mockReset();
    mockGetGiftsBySenderPage.mockReset();

    ({ GET } = await import("../route"));
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeGET("http://localhost/api/v1/gifts"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("uses cursor-based pagination by default (no page/limit params)", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockGetGiftsBySenderPaginated.mockResolvedValue({
      gifts: [MOCK_GIFT],
      total: 1,
      nextCursor: null,
    });

    const res = await GET(makeGET("http://localhost/api/v1/gifts"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockGetGiftsBySenderPaginated).toHaveBeenCalledWith("user-123", null, 10);
  });

  it("passes cursor and pageSize when provided", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockGetGiftsBySenderPaginated.mockResolvedValue({ gifts: [], total: 0, nextCursor: null });

    await GET(makeGET("http://localhost/api/v1/gifts?cursor=abc&pageSize=5"));
    expect(mockGetGiftsBySenderPaginated).toHaveBeenCalledWith("user-123", "abc", 5);
  });

  it("uses offset-based pagination when 'page' param is present", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockGetGiftsBySenderPage.mockResolvedValue({ gifts: [MOCK_GIFT], total: 1, page: 1, limit: 10 });

    const res = await GET(makeGET("http://localhost/api/v1/gifts?page=1&limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockGetGiftsBySenderPage).toHaveBeenCalledWith("user-123", 1, 10);
  });

  it("clamps limit to MAX_LIMIT (100)", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockGetGiftsBySenderPage.mockResolvedValue({ gifts: [], total: 0, page: 1, limit: 100 });

    await GET(makeGET("http://localhost/api/v1/gifts?page=1&limit=999"));
    expect(mockGetGiftsBySenderPage).toHaveBeenCalledWith("user-123", 1, 100);
  });

  it("defaults page to 1 when page=0 is supplied", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockGetGiftsBySenderPage.mockResolvedValue({ gifts: [], total: 0, page: 1, limit: 10 });

    await GET(makeGET("http://localhost/api/v1/gifts?page=0"));
    expect(mockGetGiftsBySenderPage).toHaveBeenCalledWith("user-123", 1, 10);
  });
});

// ─── POST /api/v1/gifts ───────────────────────────────────────────────────────

describe("POST /api/v1/gifts", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGetServerSession.mockReset();
    mockCreateGift.mockReset();
    mockCheckIdempotencyKey.mockReset();
    mockStoreIdempotencyResponse.mockReset();

    // Default: no idempotency key supplied → new request
    mockCheckIdempotencyKey.mockResolvedValue({ type: "new", redisKey: "k", payloadHash: "h" });
    mockStoreIdempotencyResponse.mockResolvedValue(undefined);

    ({ POST } = await import("../route"));
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makePOST(VALID_GIFT_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 400 for invalid request body (missing required field)", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    const res = await POST(makePOST({ ...VALID_GIFT_BODY, recipientName: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 400 for invalid phone number", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    const res = await POST(makePOST({ ...VALID_GIFT_BODY, recipientPhone: "not-a-phone" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 400 for amount below minimum", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    const res = await POST(makePOST({ ...VALID_GIFT_BODY, amountNgn: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 400 for unlock date in the past", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    const past = new Date(Date.now() - 1000).toISOString();
    const res = await POST(makePOST({ ...VALID_GIFT_BODY, unlockAt: past }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 201 on successful gift creation", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockCreateGift.mockResolvedValue({
      gift: MOCK_GIFT,
      paymentUrl: "https://paystack.com/pay/test",
    });

    const res = await POST(makePOST(VALID_GIFT_BODY));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.gift.id).toBe("gift-abc-123");
    expect(body.data.paymentUrl).toBeTruthy();
  });

  it("passes recipientIsRegistered from body to createGift", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockCreateGift.mockResolvedValue({ gift: MOCK_GIFT, paymentUrl: "https://paystack.com/pay/x" });

    await POST(makePOST({ ...VALID_GIFT_BODY, recipientIsRegistered: false }));
    expect(mockCreateGift).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({ recipientIsRegistered: false }),
      false
    );
  });

  it("returns 400 when idempotency key format is invalid", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockCheckIdempotencyKey.mockResolvedValue({ type: "invalid" });

    const res = await POST(
      makePOST(VALID_GIFT_BODY, { "idempotency-key": "not-a-uuid" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when idempotency key conflicts with a different payload", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockCheckIdempotencyKey.mockResolvedValue({ type: "conflict" });

    const res = await POST(
      makePOST(VALID_GIFT_BODY, { "idempotency-key": "550e8400-e29b-41d4-a716-446655440000" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("replays cached response on idempotent retry (same key + same payload)", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    // Use JSON-safe values (no Date objects) to match what is actually stored
    // in Redis and returned through JSON serialisation.
    const cachedBody = {
      success: true,
      data: {
        gift: {
          ...MOCK_GIFT,
          unlockAt: MOCK_GIFT.unlockAt.toISOString(),
          createdAt: MOCK_GIFT.createdAt.toISOString(),
          updatedAt: MOCK_GIFT.updatedAt.toISOString(),
        },
        paymentUrl: "https://x.com",
      },
    };
    mockCheckIdempotencyKey.mockResolvedValue({ type: "replay", body: cachedBody, status: 201 });

    const res = await POST(
      makePOST(VALID_GIFT_BODY, { "idempotency-key": "550e8400-e29b-41d4-a716-446655440000" })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(cachedBody);
    // createGift must NOT be called on a replay
    expect(mockCreateGift).not.toHaveBeenCalled();
  });

  it("stores idempotency response after successful creation", async () => {
    mockGetServerSession.mockResolvedValue({ user: SESSION_USER });
    mockCreateGift.mockResolvedValue({ gift: MOCK_GIFT, paymentUrl: "https://p.com" });
    mockCheckIdempotencyKey.mockResolvedValue({ type: "new", redisKey: "k", payloadHash: "h" });

    await POST(
      makePOST(VALID_GIFT_BODY, { "idempotency-key": "550e8400-e29b-41d4-a716-446655440000" })
    );
    expect(mockStoreIdempotencyResponse).toHaveBeenCalledWith("k", "h", 201, expect.any(Object));
  });
});
