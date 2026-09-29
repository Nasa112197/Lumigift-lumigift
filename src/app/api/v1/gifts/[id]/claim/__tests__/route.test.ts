/**
 * @jest-environment node
 *
 * Unit tests for:
 *   POST /api/v1/gifts/[id]/claim
 *
 * Closes #117
 */

import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));

jest.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockGetGiftById = jest.fn();
const mockHashPhone = jest.fn((phone: string) => `hash-of-${phone}`);
jest.mock("@/server/services/gift.service", () => ({
  getGiftById: (...args: unknown[]) => mockGetGiftById(...args),
  hashPhone: (phone: string) => mockHashPhone(phone),
}));

const mockClaimGift = jest.fn();
jest.mock("@/server/services/claim.service", () => ({
  claimGift: (...args: unknown[]) => mockClaimGift(...args),
}));

const mockGetInvitationByPhoneAndGift = jest.fn();
const mockClaimInvitation = jest.fn();
jest.mock("@/server/services/invitation.service", () => ({
  getInvitationByPhoneAndGift: (...args: unknown[]) => mockGetInvitationByPhoneAndGift(...args),
  claimInvitation: (...args: unknown[]) => mockClaimInvitation(...args),
}));

jest.mock("@/lib/db", () => ({
  default: { query: jest.fn() },
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

const GIFT_ID = "550e8400-e29b-41d4-a716-446655440001";
const RECIPIENT_PHONE = "+2348022334455";
// A valid 56-character Stellar public key (starts with G)
const STELLAR_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const MOCK_GIFT = {
  id: GIFT_ID,
  senderId: "sender-001",
  recipientPhoneHash: `hash-of-${RECIPIENT_PHONE}`,
  recipientName: "Ngozi Eze",
  amountNgn: 7_500,
  amountUsdc: "4.6875000",
  status: "unlocked" as const,
  unlockAt: new Date(Date.now() - 1000), // already unlocked
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeClaimRequest(giftId: string, body: unknown) {
  return [
    new NextRequest(`http://localhost/api/v1/gifts/${giftId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: giftId } },
  ] as const;
}

// ─── POST /api/v1/gifts/[id]/claim ───────────────────────────────────────────

describe("POST /api/v1/gifts/[id]/claim", () => {
  let POST: (req: NextRequest, ctx: unknown) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGetServerSession.mockReset();
    mockGetGiftById.mockReset();
    mockClaimGift.mockReset();
    mockGetInvitationByPhoneAndGift.mockReset();
    mockClaimInvitation.mockReset();
    mockHashPhone.mockImplementation((phone: string) => `hash-of-${phone}`);

    // Default: no invitation for this gift
    mockGetInvitationByPhoneAndGift.mockResolvedValue(null);

    ({ POST } = await import("../route"));
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid Stellar key (wrong length)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: "tooshort" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns 404 when gift does not exist", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(null);

    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when phone does not match recipient (anti-enumeration)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: "+2340000000000" } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);

    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    // Must NOT return 403 — that would reveal the gift exists for another user
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 403 when invitation exists but is not accepted", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);
    mockGetInvitationByPhoneAndGift.mockResolvedValue({ id: "inv-1", status: "pending" });

    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/invitation/i);
  });

  it("claims the gift and returns txHash on success", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);
    mockClaimGift.mockResolvedValue({ txHash: "abc123txhash" });

    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.txHash).toBe("abc123txhash");
    expect(mockClaimGift).toHaveBeenCalledWith(MOCK_GIFT, STELLAR_KEY);
  });

  it("marks the invitation as claimed when it exists and is accepted", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);
    mockGetInvitationByPhoneAndGift.mockResolvedValue({ id: "inv-2", status: "accepted" });
    mockClaimGift.mockResolvedValue({ txHash: "txhash999" });

    const [req, ctx] = makeClaimRequest(GIFT_ID, { recipientStellarKey: STELLAR_KEY });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockClaimInvitation).toHaveBeenCalledWith("inv-2");
  });

  it("uses route param giftId, not body giftId", async () => {
    // Passing a different giftId in body should not affect which gift is looked up
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", phone: RECIPIENT_PHONE } });
    mockGetGiftById.mockResolvedValue(MOCK_GIFT);
    mockClaimGift.mockResolvedValue({ txHash: "txhash111" });

    const [req, ctx] = makeClaimRequest(GIFT_ID, {
      recipientStellarKey: STELLAR_KEY,
      giftId: "550e8400-e29b-41d4-a716-446655440099", // different id in body
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    // Should have looked up GIFT_ID from route param, not the one in body
    expect(mockGetGiftById).toHaveBeenCalledWith(GIFT_ID);
  });
});
