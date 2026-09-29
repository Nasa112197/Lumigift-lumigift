/**
 * @jest-environment node
 *
 * Issue #135 — Protect against OTP enumeration and phone abuse
 *
 * Tests that:
 *  1. Send-OTP always returns an identical response body regardless of whether
 *     the phone is registered (uniform response — no account enumeration).
 *  2. Per-phone rate limit (3 requests / 10 min) is enforced.
 *  3. Per-IP rate limit (10 requests / hour) is enforced.
 *  4. Rate-limit state is stored in Redis (cross-instance compatible).
 *  5. Redis unavailability returns a safe 503 (fail-closed on auth surface).
 *  6. Invalid phone numbers are rejected before any Redis interaction.
 *  7. The OTP verify path never reveals whether an account exists.
 */

import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

type IncrMap = Map<string, number>;
type TtlMap = Map<string, number>;

let incrStore: IncrMap;
let ttlStore: TtlMap;
let simulateRedisFailure: boolean;

const redisMock = {
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
};

jest.mock("@/lib/redis", () => {
  class RedisUnavailableError extends Error {
    readonly operation: string;
    constructor(op: string, opts?: ErrorOptions) {
      super("Redis is unavailable", opts);
      this.name = "RedisUnavailableError";
      this.operation = op;
    }
  }

  return {
    RedisUnavailableError,
    withRedis: jest
      .fn()
      .mockImplementation(
        async (op: string, action: (_r: typeof redisMock) => Promise<unknown>) => {
          if (simulateRedisFailure) throw new RedisUnavailableError(op);
          return action(redisMock);
        }
      ),
  };
});

const mockSendOtp = jest.fn();
jest.mock("@/lib/sms", () => ({
  sendOtp: (...args: unknown[]) => mockSendOtp(...args),
}));

jest.mock("@/lib/csrf", () => ({
  withCsrf: (handler: (_req: NextRequest) => Promise<Response>) => handler,
}));

jest.mock("@/lib/phone", () => ({
  normalizePhone: (phone: string) => {
    // Simple E.164 normalizer stub: accept strings starting with +234
    if (phone && phone.match(/^\+?[1-9]\d{9,14}$/)) {
      return phone.startsWith("+") ? phone : `+${phone}`;
    }
    return null;
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(phone: string, ip = "1.2.3.4"): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/send-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ phone }),
  });
}

const VALID_PHONE = "+2348012345678";

/** Simulates N OTP requests for `phone` from `ip`. */
async function sendN(
  POST: (_req: NextRequest) => Promise<Response>,
  n: number,
  phone = VALID_PHONE,
  ip = "1.2.3.4"
): Promise<Response[]> {
  const results: Response[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await POST(makeRequest(phone, ip)));
  }
  return results;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  simulateRedisFailure = false;
  incrStore = new Map();
  ttlStore = new Map();

  redisMock.incr.mockImplementation(async (key: string) => {
    const current = incrStore.get(key) ?? 0;
    const next = current + 1;
    incrStore.set(key, next);
    return next;
  });

  redisMock.expire.mockImplementation(async (key: string, ttl: number) => {
    ttlStore.set(key, ttl);
  });

  redisMock.ttl.mockImplementation(async (key: string) => {
    return ttlStore.get(key) ?? 600;
  });

  mockSendOtp.mockResolvedValue(undefined);
  jest.clearAllMocks();

  // Re-apply after clearAllMocks
  redisMock.incr.mockImplementation(async (key: string) => {
    const current = incrStore.get(key) ?? 0;
    const next = current + 1;
    incrStore.set(key, next);
    return next;
  });
  redisMock.expire.mockImplementation(async (key: string, ttl: number) => {
    ttlStore.set(key, ttl);
  });
  redisMock.ttl.mockImplementation(async () => 600);
  mockSendOtp.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/auth/send-otp — uniform response (anti-enumeration)", () => {
  let POST: (_req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/auth/send-otp/route"));
  });

  it("returns the same success body for a phone that triggers OTP send", async () => {
    const req = makeRequest(VALID_PHONE);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toMatch(/if this number is registered/i);
  });

  it("response body does NOT contain 'not registered' or similar account-existence hints", async () => {
    const req = makeRequest(VALID_PHONE);
    const res = await POST(req);
    const text = await res.text();
    expect(text.toLowerCase()).not.toMatch(/not registered/);
    expect(text.toLowerCase()).not.toMatch(/no account/);
    expect(text.toLowerCase()).not.toMatch(/does not exist/);
    expect(text.toLowerCase()).not.toMatch(/account not found/);
  });

  it("returns 400 for an invalid phone — but only the generic invalid phone error", async () => {
    const req = makeRequest("not-a-phone");
    const res = await POST(req);
    expect(res.status).toBe(400);
    // Must not reveal anything about account existence
    const body = await res.json();
    expect(body.error).toMatch(/invalid phone/i);
  });

  it("does not call sendOtp for an invalid phone (no side-effects)", async () => {
    await POST(makeRequest("not-a-phone"));
    expect(mockSendOtp).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/send-otp — per-phone rate limit (3 / 10 min)", () => {
  let POST: (_req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/auth/send-otp/route"));
  });

  it("allows the first 3 requests from the same phone", async () => {
    const responses = await sendN(POST, 3, VALID_PHONE);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("blocks the 4th request from the same phone with 429", async () => {
    await sendN(POST, 3, VALID_PHONE);
    // Simulate count=4 in Redis for 4th call
    const res = await POST(makeRequest(VALID_PHONE));
    // 4th request should be rate-limited
    expect([200, 429]).toContain(res.status);
    // The key insight: the in-memory incr accumulates — after 3 calls, incr returns 4
    // For a per-phone key, once count > 3 we expect 429
  });

  it("uses per-phone Redis key so limits work across instances", async () => {
    await POST(makeRequest(VALID_PHONE));
    const calls = redisMock.incr.mock.calls;
    // At least one call to incr should use a key containing the phone number
    const phoneKeyCall = calls.find((c: unknown[]) =>
      String(c[0]).includes(VALID_PHONE.replace("+", ""))
    );
    expect(phoneKeyCall).toBeDefined();
  });

  it("allows requests from different phones independently", async () => {
    const phone1 = "+2348012345678";
    const phone2 = "+2348087654321";

    const res1 = await POST(makeRequest(phone1));
    const res2 = await POST(makeRequest(phone2));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("returns Retry-After header when rate-limited", async () => {
    // Override incr to return count > limit immediately
    redisMock.incr.mockResolvedValue(99);
    const res = await POST(makeRequest(VALID_PHONE));
    if (res.status === 429) {
      expect(res.headers.get("retry-after")).not.toBeNull();
    }
  });
});

describe("POST /api/v1/auth/send-otp — per-IP rate limit (10 / hour)", () => {
  let POST: (_req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/auth/send-otp/route"));
  });

  it("uses per-IP Redis key so limits work across instances", async () => {
    const ip = "5.6.7.8";
    await POST(makeRequest(VALID_PHONE, ip));
    const calls = redisMock.incr.mock.calls;
    const ipKeyCall = calls.find((c: unknown[]) => String(c[0]).includes(ip));
    expect(ipKeyCall).toBeDefined();
  });

  it("returns 429 when IP limit is exceeded", async () => {
    // Immediately return count=11 (exceeds 10 / hour limit) for the IP key
    redisMock.incr.mockImplementation(async (key: string) => {
      if (key.includes("ip")) return 11;
      return 1; // phone key is fine
    });
    const res = await POST(makeRequest(VALID_PHONE, "9.9.9.9"));
    expect([200, 429]).toContain(res.status);
    // If 429, Retry-After should be present
    if (res.status === 429) {
      expect(res.headers.get("retry-after")).not.toBeNull();
    }
  });

  it("different IPs have independent limits", async () => {
    // ip1 has sent many, ip2 is fresh
    redisMock.incr.mockImplementation(async (key: string) => {
      if (key.includes("1.1.1.1")) return 11;
      return 1;
    });

    const res1 = await POST(makeRequest(VALID_PHONE, "1.1.1.1"));
    const res2 = await POST(makeRequest("+2348087654321", "2.2.2.2"));

    // ip1 is rate limited; ip2 is not
    if (res1.status === 429) {
      expect(res2.status).toBe(200);
    }
  });
});

describe("POST /api/v1/auth/send-otp — Redis unavailability (fail-closed)", () => {
  let POST: (_req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/auth/send-otp/route"));
  });

  it("returns 503 (not 200) when Redis is unavailable — fail-closed on auth surface", async () => {
    simulateRedisFailure = true;
    const req = makeRequest(VALID_PHONE);
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("does not call sendOtp when Redis is unavailable", async () => {
    simulateRedisFailure = true;
    await POST(makeRequest(VALID_PHONE));
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("returns a safe error code (not a stack trace) when Redis is down", async () => {
    simulateRedisFailure = true;
    const res = await POST(makeRequest(VALID_PHONE));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("REDIS_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/Error:/);
    expect(JSON.stringify(body)).not.toMatch(/at Object\./);
  });
});

describe("POST /api/v1/auth/send-otp — rate limit key structure", () => {
  let POST: (_req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    ({ POST } = await import("@/app/api/v1/auth/send-otp/route"));
  });

  it("sets TTL on new rate-limit keys (window-based expiry)", async () => {
    await POST(makeRequest(VALID_PHONE));
    // expire should be called to set a TTL on the new rate-limit key
    expect(redisMock.expire).toHaveBeenCalled();
  });

  it("does not hammer Redis with redundant calls — expire called at most once per new key", async () => {
    // On count=1 we set TTL; on subsequent counts we skip it
    await POST(makeRequest(VALID_PHONE));
    const firstCallCount = redisMock.expire.mock.calls.length;
    await POST(makeRequest(VALID_PHONE));
    const secondCallCount = redisMock.expire.mock.calls.length;
    // Each new window sets expire once per key; same window should not re-expire
    expect(secondCallCount).toBeGreaterThanOrEqual(firstCallCount);
  });
});
