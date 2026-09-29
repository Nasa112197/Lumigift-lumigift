/**
 * @jest-environment node
 *
 * Stripe webhook integration tests — covers signed events, refunds,
 * duplicates, and invalid event types.
 *
 * Closes #119
 */

import { NextRequest } from "next/server";

// ─── Stripe mock ─────────────────────────────────────────────────────────────
// The mock must be defined before jest.mock is hoisted.
const mockConstructEvent = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }))
);

// ─── Gift service mock ────────────────────────────────────────────────────────
const mockUpdateGiftStatus = jest.fn();
jest.mock("@/server/services/gift.service", () => ({
  updateGiftStatus: (...args: unknown[]) => mockUpdateGiftStatus(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWebhookRequest(rawBody: string, sig: string | null) {
  return new NextRequest("http://localhost/api/v1/payments/stripe/webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      ...(sig !== null ? { "stripe-signature": sig } : {}),
    },
  });
}

/**
 * Build a minimal Stripe event payload for a given type.
 * Extra fields can be merged in via `override`.
 */
function makeStripeEvent(
  type: string,
  override: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "evt_test_000",
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "pi_test_000",
        object: "payment_intent",
        amount: 500000,
        currency: "usd",
        status: "succeeded",
        metadata: {},
        ...((override.data as Record<string, unknown>)?.object ?? {}),
      },
    },
    ...override,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/payments/stripe/webhook", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_integration_secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_key";

    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import(
          "@/app/api/v1/payments/stripe/webhook/route"
        );
        POST = mod.POST;
        resolve();
      });
    });
  });

  afterAll(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
  });

  beforeEach(() => {
    mockConstructEvent.mockReset();
    mockUpdateGiftStatus.mockReset();
  });

  // ── Authentication / Signature verification ──────────────────────────────

  it("returns 400 when Stripe-Signature header is absent", async () => {
    const res = await POST(makeWebhookRequest("{}", null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/missing stripe-signature/i);
  });

  it("returns 400 when the signature is invalid (raw body was tampered)", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const res = await POST(makeWebhookRequest('{"tampered":true}', "t=111,v1=invalidsig"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/signature verification failed/i);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET env var is missing", async () => {
    // We need a fresh module import without the env var
    const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    let freshPOST: (req: NextRequest) => Promise<Response>;
    await new Promise<void>((resolve) => {
      jest.isolateModules(async () => {
        const mod = await import("@/app/api/v1/payments/stripe/webhook/route");
        freshPOST = mod.POST;
        resolve();
      });
    });

    const res = await freshPOST!(makeWebhookRequest("{}", "t=1,v1=x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);

    process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
  });

  // ── payment_intent.succeeded ─────────────────────────────────────────────

  it("transitions gift to 'locked' on payment_intent.succeeded with giftId metadata", async () => {
    const event = makeStripeEvent("payment_intent.succeeded", {
      data: { object: { metadata: { giftId: "gift-stripe-001" } } },
    });
    mockConstructEvent.mockReturnValue(event);
    mockUpdateGiftStatus.mockResolvedValue({ id: "gift-stripe-001", status: "locked" });

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=validsig"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.received).toBe(true);
    expect(mockUpdateGiftStatus).toHaveBeenCalledWith("gift-stripe-001", "locked");
  });

  it("does NOT call updateGiftStatus when metadata.giftId is absent", async () => {
    const event = makeStripeEvent("payment_intent.succeeded", {
      data: { object: { metadata: {} } },
    });
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=validsig"));
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Invalid / unknown event types ────────────────────────────────────────

  it("returns 200 and ignores an unknown event type (no-op)", async () => {
    const event = makeStripeEvent("account.updated");
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=validsig"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.received).toBe(true);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 200 and ignores payment_intent.payment_failed (not a gift unlock event)", async () => {
    const event = makeStripeEvent("payment_intent.payment_failed", {
      data: { object: { metadata: { giftId: "gift-stripe-002" } } },
    });
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=validsig"));
    expect(res.status).toBe(200);
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  it("returns 200 and ignores charge.refunded (handled separately)", async () => {
    const event = makeStripeEvent("charge.refunded", {
      data: {
        object: {
          id: "ch_test_refund",
          object: "charge",
          refunded: true,
          metadata: { giftId: "gift-stripe-003" },
        },
      },
    });
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=validsig"));
    expect(res.status).toBe(200);
    // Webhook currently only acts on payment_intent.succeeded — refunds not processed here
    expect(mockUpdateGiftStatus).not.toHaveBeenCalled();
  });

  // ── Duplicate event handling ──────────────────────────────────────────────

  it("handles duplicate payment_intent.succeeded events idempotently", async () => {
    const giftId = "gift-stripe-dup-001";
    const event = makeStripeEvent("payment_intent.succeeded", {
      data: { object: { metadata: { giftId } } },
    });
    mockConstructEvent.mockReturnValue(event);
    mockUpdateGiftStatus.mockResolvedValue({ id: giftId, status: "locked" });

    // First delivery
    const res1 = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=sig1"));
    expect(res1.status).toBe(200);

    // Duplicate delivery — updateGiftStatus should be called again since the route
    // doesn't deduplicate by event ID (Stripe guarantees at-least-once delivery;
    // the underlying updateGiftStatus is itself idempotent via assertValidTransition).
    const res2 = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=sig1"));
    expect(res2.status).toBe(200);

    // Both calls succeed — idempotency is enforced at the service layer
    expect(mockUpdateGiftStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateGiftStatus).toHaveBeenNthCalledWith(1, giftId, "locked");
    expect(mockUpdateGiftStatus).toHaveBeenNthCalledWith(2, giftId, "locked");
  });

  // ── Raw body integrity ────────────────────────────────────────────────────

  it("passes raw body text (not parsed JSON) to constructEvent for signature verification", async () => {
    const rawBody = '{"id":"evt_raw","type":"payment_intent.succeeded","data":{"object":{"metadata":{}}}}';
    const sig = "t=1234,v1=rawbodysig";

    mockConstructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: { metadata: {} } },
    });

    await POST(makeWebhookRequest(rawBody, sig));

    // constructEvent must receive the exact raw string, not a re-serialised JSON
    expect(mockConstructEvent).toHaveBeenCalledWith(
      rawBody,                        // exact raw body
      sig,                            // exact signature header value
      "whsec_test_integration_secret" // env var value
    );
  });

  // ── Response shape ────────────────────────────────────────────────────────

  it("always returns { success: true, data: { received: true } } on valid events", async () => {
    const event = makeStripeEvent("invoice.payment_succeeded");
    mockConstructEvent.mockReturnValue(event);

    const res = await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=sig"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      data: { received: true },
    });
  });

  // ── Database lifecycle matching ───────────────────────────────────────────

  it("gift status in store matches Stripe payment lifecycle after succeeded event", async () => {
    const giftId = "gift-lifecycle-001";
    const event = makeStripeEvent("payment_intent.succeeded", {
      data: { object: { metadata: { giftId } } },
    });
    mockConstructEvent.mockReturnValue(event);

    // Simulate gift service updating status correctly
    let capturedStatus: string | null = null;
    mockUpdateGiftStatus.mockImplementation(async (id: string, status: string) => {
      capturedStatus = status;
      return { id, status };
    });

    await POST(makeWebhookRequest(JSON.stringify(event), "t=1,v1=sig"));

    // Verify the gift was transitioned to 'locked' — matching Stripe's lifecycle
    expect(capturedStatus).toBe("locked");
  });
});
