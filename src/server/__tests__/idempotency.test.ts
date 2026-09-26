/**
 * @jest-environment node
 *
 * Unit tests for src/server/idempotency.ts (Issue #58)
 *
 * Mocks:
 *  - @/lib/redis → getRedisClient
 *
 * Covers:
 *  - Missing key → "missing" (no idempotency guarantee, proceeds normally)
 *  - Invalid key (not UUID v4) → "invalid"
 *  - New key, no prior record → "new"
 *  - Same key + same payload → "replay" with cached response
 *  - Same key + different payload → "conflict"
 *  - Corrupted Redis record → treated as new
 *  - storeIdempotencyResponse persists the record with correct TTL
 *  - buildIdempotencyRedisKey and hashPayload helpers
 */

// ─── Redis mock ───────────────────────────────────────────────────────────────

let redisMock: {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
};

jest.mock("@/lib/redis", () => {
  const mock = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  (global as unknown as Record<string, unknown>).__idempotencyRedisMock = mock;
  return { getRedisClient: jest.fn(() => Promise.resolve(mock)) };
});

// ─── Logger mock ──────────────────────────────────────────────────────────────

jest.mock("@/lib/logger", () => ({
  serviceLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import {
  checkIdempotencyKey,
  storeIdempotencyResponse,
  buildIdempotencyRedisKey,
  hashPayload,
  isValidIdempotencyKey,
  IDEMPOTENCY_TTL_SECONDS,
} from "@/server/idempotency";

// ─── Setup ────────────────────────────────────────────────────────────────────

const USER_ID = "user-abc-123";
const VALID_KEY = "550e8400-e29b-41d4-a716-446655440000";
const PAYLOAD = { recipientPhone: "+2348012345678", amountNgn: 5000 };

beforeEach(() => {
  jest.clearAllMocks();
  redisMock = (global as unknown as Record<string, typeof redisMock>).__idempotencyRedisMock;
  redisMock.get.mockResolvedValue(null); // no record by default
  redisMock.set.mockResolvedValue("OK");
  redisMock.del.mockResolvedValue(1);
});

// ─── isValidIdempotencyKey ────────────────────────────────────────────────────

describe("isValidIdempotencyKey", () => {
  it("accepts a valid UUID v4", () => {
    expect(isValidIdempotencyKey(VALID_KEY)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidIdempotencyKey("")).toBe(false);
  });

  it("rejects a random string", () => {
    expect(isValidIdempotencyKey("not-a-uuid")).toBe(false);
  });

  it("rejects a UUID v1 (not v4)", () => {
    expect(isValidIdempotencyKey("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(false);
  });
});

// ─── buildIdempotencyRedisKey ─────────────────────────────────────────────────

describe("buildIdempotencyRedisKey", () => {
  it("produces a key scoped to the user", () => {
    const key = buildIdempotencyRedisKey("user-1", "my-key");
    expect(key).toBe("idempotency:user-1:my-key");
  });
});

// ─── hashPayload ──────────────────────────────────────────────────────────────

describe("hashPayload", () => {
  it("returns a consistent SHA-256 hex string", () => {
    const h1 = hashPayload(PAYLOAD);
    const h2 = hashPayload(PAYLOAD);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different payloads", () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});

// ─── checkIdempotencyKey ──────────────────────────────────────────────────────

describe("checkIdempotencyKey — missing key", () => {
  it("returns 'missing' when header is null", async () => {
    const result = await checkIdempotencyKey(null, USER_ID, PAYLOAD);
    expect(result.type).toBe("missing");
  });
});

describe("checkIdempotencyKey — invalid key", () => {
  it("returns 'invalid' for a non-UUID key", async () => {
    const result = await checkIdempotencyKey("bad-key", USER_ID, PAYLOAD);
    expect(result.type).toBe("invalid");
  });
});

describe("checkIdempotencyKey — new key", () => {
  it("returns 'new' when no record exists in Redis", async () => {
    redisMock.get.mockResolvedValue(null);
    const result = await checkIdempotencyKey(VALID_KEY, USER_ID, PAYLOAD);
    expect(result.type).toBe("new");
    if (result.type === "new") {
      expect(result.idempotencyKey).toBe(VALID_KEY);
      expect(result.redisKey).toBe(buildIdempotencyRedisKey(USER_ID, VALID_KEY));
      expect(result.payloadHash).toBe(hashPayload(PAYLOAD));
    }
  });
});

describe("checkIdempotencyKey — replay (same key + same payload)", () => {
  it("returns 'replay' with the cached response body and status", async () => {
    const cachedBody = { success: true, data: { gift: { id: "g1" }, paymentUrl: "https://pay" } };
    const stored = JSON.stringify({
      payloadHash: hashPayload(PAYLOAD),
      status: 201,
      body: JSON.stringify(cachedBody),
    });
    redisMock.get.mockResolvedValue(stored);

    const result = await checkIdempotencyKey(VALID_KEY, USER_ID, PAYLOAD);
    expect(result.type).toBe("replay");
    if (result.type === "replay") {
      expect(result.status).toBe(201);
      expect(result.body).toEqual(cachedBody);
    }
  });
});

describe("checkIdempotencyKey — conflict (same key + different payload)", () => {
  it("returns 'conflict' when payload hash does not match", async () => {
    const differentPayload = { ...PAYLOAD, amountNgn: 99_999 };
    const stored = JSON.stringify({
      payloadHash: hashPayload(differentPayload),
      status: 201,
      body: JSON.stringify({ success: true }),
    });
    redisMock.get.mockResolvedValue(stored);

    const result = await checkIdempotencyKey(VALID_KEY, USER_ID, PAYLOAD);
    expect(result.type).toBe("conflict");
  });
});

describe("checkIdempotencyKey — corrupted record", () => {
  it("treats a corrupted Redis record as 'new' and deletes it", async () => {
    redisMock.get.mockResolvedValue("not-valid-json{{{");
    const result = await checkIdempotencyKey(VALID_KEY, USER_ID, PAYLOAD);
    expect(result.type).toBe("new");
    expect(redisMock.del).toHaveBeenCalled();
  });
});

// ─── storeIdempotencyResponse ─────────────────────────────────────────────────

describe("storeIdempotencyResponse", () => {
  it("stores a JSON record in Redis with the correct TTL", async () => {
    const redisKey = buildIdempotencyRedisKey(USER_ID, VALID_KEY);
    const payloadHash = hashPayload(PAYLOAD);
    const body = { success: true, data: { gift: { id: "g1" } } };

    await storeIdempotencyResponse(redisKey, payloadHash, 201, body);

    expect(redisMock.set).toHaveBeenCalledWith(redisKey, expect.stringContaining(payloadHash), {
      EX: IDEMPOTENCY_TTL_SECONDS,
    });
  });

  it("stored record contains the correct status and body", async () => {
    const redisKey = buildIdempotencyRedisKey(USER_ID, VALID_KEY);
    const payloadHash = hashPayload(PAYLOAD);
    const body = { success: true, data: { giftId: "g42" } };

    await storeIdempotencyResponse(redisKey, payloadHash, 201, body);

    const [[, rawValue]] = (redisMock.set as jest.Mock).mock.calls;
    const record = JSON.parse(rawValue as string);
    expect(record.status).toBe(201);
    expect(JSON.parse(record.body)).toEqual(body);
    expect(record.payloadHash).toBe(payloadHash);
  });
});
