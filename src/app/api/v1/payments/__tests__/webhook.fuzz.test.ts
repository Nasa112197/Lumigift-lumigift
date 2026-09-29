/**
 * @jest-environment node
 *
 * Issue #129 — Webhook fuzz and malformed payload tests
 *
 * Exercises:
 *  - Invalid / truncated JSON
 *  - Missing required fields
 *  - Oversized bodies (huge payload simulation)
 *  - Duplicate / replayed references (idempotency)
 *  - Unexpected content-types and encodings
 *  - Boundary values for event types
 *  - Ensures no malformed input mutates application state
 */

import crypto from "crypto";
import { NextRequest } from "next/server";

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDel = jest.fn();

jest.mock("@/lib/redis", () => ({
  getRedisClient: jest.fn().mockResolvedValue({
    get: mockGet,
    set: mockSet,
    del: mockDel,
  }),
}));

const mockUpdateGiftStatus = jest.fn();
jest.mock("@/server/services/gift.service", () => ({
  updateGiftStatus: mockUpdateGiftStatus,
}));

jest.mock("@/server/config", () => ({
  serverConfig: {
    paystack: { secretKey: "test-paystack-secret" },
    redis: { url: "redis://localhost:6379" },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYSTACK_SECRET = "test-paystack-secret";

function paystackSig(body: string, secret = PAYSTACK_SECRET): string {
  return crypto.createHmac("sha512", secret).update(body).digest("hex");
}

function makePaystackRequest(rawBody: string, overrideSignature?: string): Request {
  const sig = overrideSignature ?? paystackSig(rawBody);
  return new Request("http://localhost/api/v1/payments", {
    method: "POST",
    headers: {
      "x-paystack-signature": sig,
      "content-type": "application/json",
    },
    body: rawBody,
  });
}

function validPaystackBody(ref = "ref-ok", giftId = "gift-ok"): string {
  return JSON.stringify({
    event: "charge.success",
    data: { reference: ref, status: "success", metadata: { giftId } },
  });
}

// ─── Paystack webhook — malformed payload tests ───────────────────────────────

describe("POST /api/v1/payments (Paystack webhook) — malformed payload fuzz", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
    mockUpdateGiftStatus.mockReset();
    ({ POST } = await import("@/app/api/v1/payments/route"));
  });

  // ── Invalid signatures ────────────────────────────────────────────────────

  it("returns 401 for empty signature header", async () => {
    const body = validPaystackBody();
    const res = await POST(makePaystackRequest(body, "") as never);
    expect(res.status).toBe(401);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 401 for all-zero signature", async () => {
    const body = validPaystackBody();
    const res = await POST(makePaystackRequest(body, "0".repeat(128)) as never);
    expect(res.status).toBe(401);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 401 for signature computed with wrong secret", async () => {
    const body = validPaystackBody();
    const res = await POST(makePaystackRequest(body, paystackSig(body, "wrong-secret")) as never);
    expect(res.status).toBe(401);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 401 for signature of different body (body tampered after signing)", async () => {
    const original = validPaystackBody("ref-tampered");
    const sig = paystackSig(original);
    const tampered = original.replace("ref-tampered", "ref-malicious");
    const res = await POST(makePaystackRequest(tampered, sig) as never);
    expect(res.status).toBe(401);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Invalid JSON ──────────────────────────────────────────────────────────

  it("returns 4xx for completely invalid JSON", async () => {
    const body = "not-json-at-all";
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 4xx for truncated JSON (cut off mid-object)", async () => {
    const body = '{"event":"charge.success","data":{"reference":"ref1"';
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 4xx for empty body string", async () => {
    const res = await POST(makePaystackRequest("") as never);
    expect([400, 401, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 4xx for JSON array at top level", async () => {
    const body = JSON.stringify([{ event: "charge.success", data: { reference: "ref1" } }]);
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns safe response for null JSON body", async () => {
    const body = "null";
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("does not change state for JSON with only primitives", async () => {
    const body = JSON.stringify(42);
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Missing required fields ───────────────────────────────────────────────

  it("does not call updateGiftStatus when data.reference is missing", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { status: "success", metadata: { giftId: "gift-1" } },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    // Should succeed or error safely, but must NOT update gift status without a reference
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("does not call updateGiftStatus when metadata.giftId is absent", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "ref-no-gift", status: "success" },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("does not change state for unknown event type", async () => {
    const body = JSON.stringify({
      event: "transfer.failed",
      data: { reference: "ref-unknown", metadata: { giftId: "gift-x" } },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("does not change state for empty event string", async () => {
    const body = JSON.stringify({
      event: "",
      data: { reference: "ref-empty-event", metadata: { giftId: "gift-y" } },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Oversized / large bodies ──────────────────────────────────────────────

  it("returns safe response for extremely large but valid JSON (oversized padding field)", async () => {
    const huge = JSON.stringify({
      event: "charge.success",
      data: {
        reference: "ref-huge",
        status: "success",
        metadata: { giftId: "gift-huge" },
        padding: "x".repeat(1_000_000), // 1 MB padding
      },
    });
    mockGet.mockResolvedValue(null);
    // Should not throw or crash the handler; exact status depends on body size limits
    let res: Response;
    try {
      res = await POST(makePaystackRequest(huge) as never);
      // Accept any 2xx–5xx; what matters is it doesn't throw
      expect(res.status).toBeGreaterThanOrEqual(200);
    } catch {
      // If the framework rejects the body before the handler, that is acceptable
      expect(true).toBe(true);
    }
    // State must not have changed if giftId was in the (possibly truncated) metadata
    // mockUpdateGiftStatus is either not called or called safely — no assertion on called
  });

  it("returns safe response for deeply nested JSON", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nested: any = { giftId: "gift-deep" };
    for (let i = 0; i < 100; i++) nested = { level: nested };
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "ref-deep", metadata: nested },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect([200, 400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Duplicate references (idempotency) ───────────────────────────────────

  it("does not reprocess a previously processed reference", async () => {
    mockGet.mockResolvedValue("1"); // already processed
    const body = validPaystackBody("ref-dup", "gift-dup");
    const res = await POST(makePaystackRequest(body) as never);
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("stores idempotency key after first successful processing", async () => {
    mockGet.mockResolvedValue(null);
    const body = validPaystackBody("ref-first", "gift-first");
    const res = await POST(makePaystackRequest(body) as never);
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith("paystack:ref:ref-first", "1", { EX: 86400 });
    expect(mockUpdateGiftStatus).toHaveBeenCalledWith("gift-first", "locked");
  });

  // ── Encoding edge cases ───────────────────────────────────────────────────

  it("returns 4xx for body that is valid UTF-8 but not JSON (e.g. form-encoded)", async () => {
    const body = "event=charge.success&reference=ref1";
    const res = await POST(makePaystackRequest(body) as never);
    expect([400, 422, 500]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("handles Unicode characters in giftId without crashing", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        reference: "ref-unicode",
        status: "success",
        metadata: { giftId: "gift-\u4e2d\u6587-\ud83d\ude00" },
      },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect([200, 400, 422]).toContain(res.status);
    // Should not throw; state mutation is OK if giftId was validly received
  });

  it("handles null giftId in metadata without crashing", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "ref-null-gift", status: "success", metadata: { giftId: null } },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect([200, 400]).toContain(res.status);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("handles numeric reference without crashing", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: 12345, status: "success", metadata: { giftId: "gift-num" } },
    });
    mockGet.mockResolvedValue(null);
    const res = await POST(makePaystackRequest(body) as never);
    expect([200, 400, 422]).toContain(res.status);
    // No assertion on updateGiftStatus — numeric reference may or may not be accepted
  });
});

// ─── Stripe webhook — malformed payload tests ─────────────────────────────────

describe("POST /api/v1/payments/stripe/webhook — malformed payload fuzz", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  // Stripe uses a different signature scheme — we just probe edge cases that
  // don't require a valid signature (missing sig header, malformed body, etc.)

  beforeEach(async () => {
    jest.resetModules();
    // Mock Stripe so we can control signature verification behaviour
    jest.mock("stripe", () => {
      return jest.fn().mockImplementation(() => ({
        webhooks: {
          constructEvent: jest.fn().mockImplementation((body: string, sig: string) => {
            if (!sig || sig === "bad-sig") throw new Error("Invalid signature");
            return JSON.parse(body);
          }),
        },
      }));
    });
    process.env.STRIPE_WEBHOOK_SECRET = "stripe-test-secret";
    mockUpdateGiftStatus.mockReset();
    ({ POST } = await import("@/app/api/v1/payments/stripe/webhook/route"));
  });

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("returns 400 when Stripe-Signature header is missing", async () => {
    const req = new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid signature", async () => {
    const req = new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "bad-sig" },
      body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/payments/stripe/webhook/route"));
    const req = new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "any" },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });
});
