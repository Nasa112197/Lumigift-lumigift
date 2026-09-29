/**
 * @jest-environment node
 *
 * Authorization Matrix Tests — Issue #123
 *
 * Verifies that every protected endpoint enforces server-side auth:
 * UI hiding is NEVER the only control. Each row in the matrix tests
 * a persona × endpoint × expected HTTP status combination.
 *
 * Personas tested:
 *   - anonymous         — no session cookie
 *   - sender            — authenticated, owns the gift
 *   - cross-user        — authenticated, does NOT own the gift
 *   - admin             — authenticated + role = 'admin'
 *   - expired-session   — session present but user row deleted
 *   - recipient         — authenticated, is the gift recipient by phone hash
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// ─── Shared mock state ────────────────────────────────────────────────────────

type SessionUser = { id: string; phone?: string; name?: string } | null;
let mockSessionUser: SessionUser = null;

// DB rows available to mocks
const TEST_SENDER_ID = "user-sender-1";
const TEST_OTHER_ID = "user-other-2";
const TEST_ADMIN_ID = "user-admin-3";
const TEST_RECIPIENT_PHONE = "+2348011111111";
const TEST_GIFT_ID = "gift-matrix-1";

function hashPhone(phone: string) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

const RECIPIENT_HASH = hashPhone(TEST_RECIPIENT_PHONE);

const MOCK_GIFT = {
  id: TEST_GIFT_ID,
  senderId: TEST_SENDER_ID,
  recipientName: "Test Recipient",
  recipientPhoneHash: RECIPIENT_HASH,
  amountNgn: 5000,
  amountUsdc: "3.0",
  message: "Happy Birthday",
  mediaUrl: null,
  unlockAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  status: "locked" as const,
  stellarTxHash: null,
  claimTxHash: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock declarations ────────────────────────────────────────────────────────

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("@/server/services/gift.service", () => ({
  getGiftsBySenderPaginated: jest.fn().mockResolvedValue({ gifts: [], nextCursor: null }),
  getGiftsBySenderPage: jest.fn().mockResolvedValue({ gifts: [], total: 0 }),
  createGift: jest.fn().mockResolvedValue({ gift: MOCK_GIFT, paymentUrl: "https://pay.example" }),
  getGiftById: jest.fn().mockResolvedValue(MOCK_GIFT),
  cancelGift: jest.fn().mockResolvedValue({ ...MOCK_GIFT, status: "cancelled" }),
  hashPhone,
}));

jest.mock("@/lib/paystack", () => ({
  refundPayment: jest.fn().mockResolvedValue({ status: "pending" }),
}));

jest.mock("@/server/services/admin-gift.service", () => ({
  adminListGifts: jest.fn().mockReturnValue({ gifts: [], nextCursor: null }),
  adminGetGift: jest.fn().mockReturnValue(MOCK_GIFT),
  logAdminAction: jest.fn(),
}));

jest.mock("@/server/services/audit.service", () => ({
  queryAuditLogs: jest.fn().mockResolvedValue({ logs: [], total: 0 }),
}));

jest.mock("@/server/config", () => ({
  serverConfig: {
    paystack: { secretKey: "test-paystack-key" },
    redis: { url: "redis://localhost:6379" },
    app: { url: "http://localhost:3000" },
  },
}));

jest.mock("@/lib/redis", () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
  }),
}));

jest.mock("@/lib/csrf", () => ({
  withCsrf: (handler: unknown) => handler,
}));

jest.mock("@/server/idempotency", () => ({
  checkIdempotencyKey: jest
    .fn()
    .mockResolvedValue({ type: "new", redisKey: "k", payloadHash: "h" }),
  storeIdempotencyResponse: jest.fn().mockResolvedValue(undefined),
  IDEMPOTENCY_KEY_HEADER: "idempotency-key",
}));

jest.mock("@sentry/nextjs", () => ({
  withScope: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock("@/lib/cloudinary", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue("https://res.cloudinary.com/test/image.jpg"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { getServerSession } from "next-auth";
import pool from "@/lib/db";

const mockGetServerSession = getServerSession as jest.Mock;
const mockPool = pool as unknown as { query: jest.Mock };

/** Set the active persona. Pass null for anonymous. */
function setSession(user: SessionUser) {
  mockSessionUser = user;
  mockGetServerSession.mockResolvedValue(user ? { user } : null);
}

/** Build a minimal NextRequest for route handler invocation. */
function makeReq(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  const url = `http://localhost${path}`;
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Mock pool to return admin role for a given userId. */
function mockAdminRole(userId: string) {
  mockPool.query.mockResolvedValue({ rows: [{ role: "admin" }] });
  setSession({ id: userId });
}

/** Mock pool to return user (non-admin) role. */
function mockUserRole(userId: string) {
  mockPool.query.mockResolvedValue({ rows: [{ role: "user" }] });
  setSession({ id: userId });
}

/** Mock pool to return no rows (user deleted / expired session). */
function mockExpiredSession(userId: string) {
  mockPool.query.mockResolvedValue({ rows: [] });
  setSession({ id: userId });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Authorization Matrix — Issue #123", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/gifts
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/gifts", () => {
    let GET: (req: NextRequest) => Promise<NextResponse>;

    beforeEach(async () => {
      jest.resetModules();
      ({ GET } = await import("@/app/api/v1/gifts/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await GET(makeReq("/api/v1/gifts"));
      expect(res.status).toBe(401);
    });

    it("authenticated sender → 200", async () => {
      setSession({ id: TEST_SENDER_ID });
      const res = await GET(makeReq("/api/v1/gifts"));
      expect(res.status).toBe(200);
    });

    it("cross-user (different user) → 200 (returns their own empty list)", async () => {
      // The route filters by the session user's ID, so another user just gets their own gifts
      setSession({ id: TEST_OTHER_ID });
      const res = await GET(makeReq("/api/v1/gifts"));
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/v1/gifts
  // ═══════════════════════════════════════════════════════════════════════
  describe("POST /api/v1/gifts", () => {
    let POST: (req: NextRequest) => Promise<NextResponse>;

    const validGiftBody = {
      recipientPhone: "+2348012345678",
      recipientName: "Jane Doe",
      amountNgn: 5000,
      message: "Happy Birthday!",
      unlockAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      recipientIsRegistered: false,
    };

    beforeEach(async () => {
      jest.resetModules();
      ({ POST } = await import("@/app/api/v1/gifts/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await POST(makeReq("/api/v1/gifts", "POST", validGiftBody));
      expect(res.status).toBe(401);
    });

    it("authenticated sender with valid body → 201", async () => {
      setSession({ id: TEST_SENDER_ID });
      const res = await POST(makeReq("/api/v1/gifts", "POST", validGiftBody));
      expect(res.status).toBe(201);
    });

    it("authenticated user sends gift — server enforces auth, not UI", async () => {
      // Even if someone bypasses the UI, the route still requires a session
      setSession(null);
      const res = await POST(makeReq("/api/v1/gifts", "POST", validGiftBody));
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/gifts/[id]
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/gifts/[id]", () => {
    let GET: (req: NextRequest, ctx: unknown) => Promise<NextResponse>;

    beforeEach(async () => {
      jest.resetModules();
      ({ GET } = await import("@/app/api/v1/gifts/[id]/route"));
    });

    const ctx = { params: { id: TEST_GIFT_ID } };

    it("anonymous → 200 with restricted fields only (public claim page)", async () => {
      setSession(null);
      const res = await GET(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(200);
      const body = await res.json();
      // Public view must NOT include senderId or recipientPhoneHash
      expect(body.data).not.toHaveProperty("senderId");
      expect(body.data).not.toHaveProperty("recipientPhoneHash");
    });

    it("sender → 200 with full gift data", async () => {
      setSession({ id: TEST_SENDER_ID });
      const res = await GET(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("recipient (matching phone hash) → 200 with full gift data", async () => {
      setSession({ id: "user-recipient", phone: TEST_RECIPIENT_PHONE });
      const res = await GET(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(200);
    });

    it("cross-user (unrelated) → 200 with restricted fields only", async () => {
      setSession({ id: TEST_OTHER_ID, phone: "+2349099999999" });
      const res = await GET(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).not.toHaveProperty("senderId");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DELETE /api/v1/gifts/[id]
  // ═══════════════════════════════════════════════════════════════════════
  describe("DELETE /api/v1/gifts/[id]", () => {
    let DELETE: (req: NextRequest, ctx: unknown) => Promise<NextResponse>;

    const pendingGift = {
      ...MOCK_GIFT,
      status: "pending_payment" as const,
      unlockAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    const ctx = { params: { id: TEST_GIFT_ID } };

    beforeEach(async () => {
      jest.resetModules();
      const { getGiftById } = await import("@/server/services/gift.service");
      (getGiftById as jest.Mock).mockResolvedValue(pendingGift);
      ({ DELETE } = await import("@/app/api/v1/gifts/[id]/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await DELETE(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`, "DELETE"), ctx);
      expect(res.status).toBe(401);
    });

    it("cross-user (not the sender) → 403", async () => {
      setSession({ id: TEST_OTHER_ID });
      const res = await DELETE(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`, "DELETE"), ctx);
      expect(res.status).toBe(403);
    });

    it("sender → 200", async () => {
      setSession({ id: TEST_SENDER_ID });
      const res = await DELETE(makeReq(`/api/v1/gifts/${TEST_GIFT_ID}`, "DELETE"), ctx);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/admin/gifts
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/admin/gifts", () => {
    let GET: (req: NextRequest) => Promise<NextResponse>;

    beforeEach(async () => {
      jest.resetModules();
      ({ GET } = await import("@/app/api/v1/admin/gifts/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await GET(makeReq("/api/v1/admin/gifts"));
      expect(res.status).toBe(401);
    });

    it("regular user → 403", async () => {
      mockUserRole(TEST_SENDER_ID);
      const res = await GET(makeReq("/api/v1/admin/gifts"));
      expect(res.status).toBe(403);
    });

    it("admin → 200", async () => {
      mockAdminRole(TEST_ADMIN_ID);
      const res = await GET(makeReq("/api/v1/admin/gifts"));
      expect(res.status).toBe(200);
    });

    it("expired session (user deleted) → 403", async () => {
      mockExpiredSession(TEST_SENDER_ID);
      const res = await GET(makeReq("/api/v1/admin/gifts"));
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/admin/gifts/[id]
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/admin/gifts/[id]", () => {
    let GET: (req: NextRequest, ctx: unknown) => Promise<NextResponse>;
    const ctx = { params: { id: TEST_GIFT_ID } };

    beforeEach(async () => {
      jest.resetModules();
      ({ GET } = await import("@/app/api/v1/admin/gifts/[id]/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await GET(makeReq(`/api/v1/admin/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(401);
    });

    it("regular user → 403", async () => {
      mockUserRole(TEST_SENDER_ID);
      const res = await GET(makeReq(`/api/v1/admin/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(403);
    });

    it("admin → 200", async () => {
      mockAdminRole(TEST_ADMIN_ID);
      const res = await GET(makeReq(`/api/v1/admin/gifts/${TEST_GIFT_ID}`), ctx);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/admin/audit-logs
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/admin/audit-logs", () => {
    let GET: (req: NextRequest) => Promise<NextResponse>;

    beforeEach(async () => {
      jest.resetModules();
      ({ GET } = await import("@/app/api/v1/admin/audit-logs/route"));
    });

    it("anonymous → 401", async () => {
      setSession(null);
      const res = await GET(makeReq("/api/v1/admin/audit-logs"));
      expect(res.status).toBe(401);
    });

    it("regular user → 403", async () => {
      mockUserRole(TEST_SENDER_ID);
      const res = await GET(makeReq("/api/v1/admin/audit-logs"));
      expect(res.status).toBe(403);
    });

    it("admin → 200", async () => {
      mockAdminRole(TEST_ADMIN_ID);
      const res = await GET(makeReq("/api/v1/admin/audit-logs"));
      expect(res.status).toBe(200);
    });

    it("cross-user (non-admin authenticated) cannot access audit logs", async () => {
      mockUserRole(TEST_OTHER_ID);
      const res = await GET(makeReq("/api/v1/admin/audit-logs"));
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/v1/users  (public phone-existence check — intentionally unauthenticated)
  // ═══════════════════════════════════════════════════════════════════════
  describe("GET /api/v1/users", () => {
    let GET: (req: NextRequest) => Promise<NextResponse>;

    beforeEach(async () => {
      jest.resetModules();
      // Re-mock db after module reset so the freshly imported route uses our mock
      jest.mock("@/lib/db", () => ({
        __esModule: true,
        default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
      }));
      ({ GET } = await import("@/app/api/v1/users/route"));
    });

    it("returns 400 without phone param (no auth required by design)", async () => {
      setSession(null);
      const res = await GET(makeReq("/api/v1/users"));
      // No phone param supplied → validation error, not auth error
      expect(res.status).toBe(400);
    });

    it("anonymous with phone param → 200 (public endpoint by design)", async () => {
      setSession(null);
      const res = await GET(makeReq("/api/v1/users?phone=%2B2348012345678"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveProperty("exists");
    });

    it("authenticated user with phone param → 200", async () => {
      setSession({ id: TEST_SENDER_ID });
      const res = await GET(makeReq("/api/v1/users?phone=%2B2348012345678"));
      expect(res.status).toBe(200);
    });
  });
});
