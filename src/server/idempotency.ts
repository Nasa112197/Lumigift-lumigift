/**
 * Idempotency Key middleware for gift creation (Issue #58).
 *
 * Prevents duplicate gifts and payment intents from being created when
 * clients retry a POST request (network failures, double-submits, etc.).
 *
 * Protocol:
 *  1. Client sends `Idempotency-Key: <uuid>` header with the POST body.
 *  2. First call: proceeds normally, response is stored in Redis.
 *  3. Retry with same key + same payload: returns the cached response (200).
 *  4. Same key with a different payload: rejected with 409 IDEMPOTENCY_CONFLICT.
 *  5. Keys expire after IDEMPOTENCY_TTL_SECONDS (24 hours).
 *
 * Key format: `idempotency:{userId}:{idempotencyKey}`
 * This scopes keys per-user so one user's key never collides with another's.
 */

import { getRedisClient } from "@/lib/redis";
import { serviceLogger } from "@/lib/logger";
import { createHash } from "crypto";

const log = serviceLogger("idempotency");

/** TTL for stored idempotency records — 24 hours. */
export const IDEMPOTENCY_TTL_SECONDS = 86_400;

/** Header name clients must send. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** UUID v4 pattern — keys must match this format. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Stored record shape ──────────────────────────────────────────────────────

interface IdempotencyRecord {
  /** SHA-256 of the serialised request payload — used to detect payload mismatches. */
  payloadHash: string;
  /** HTTP status code of the original response. */
  status: number;
  /** Serialised response body (JSON string). */
  body: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build the Redis key for a given user and idempotency key string. */
export function buildIdempotencyRedisKey(userId: string, idempotencyKey: string): string {
  return `idempotency:${userId}:${idempotencyKey}`;
}

/** SHA-256 hash of a payload object for mismatch detection. */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Validate that the idempotency key is a UUID v4. */
export function isValidIdempotencyKey(key: string): boolean {
  return UUID_RE.test(key);
}

// ─── Core functions ───────────────────────────────────────────────────────────

export type IdempotencyCheckResult =
  | { type: "missing" }
  | { type: "invalid" }
  | { type: "replay"; status: number; body: unknown }
  | { type: "conflict" }
  | { type: "new"; idempotencyKey: string; payloadHash: string; redisKey: string };

/**
 * Check the `Idempotency-Key` header and look up any existing record.
 *
 * @param idempotencyKey - Value from the `Idempotency-Key` header.
 * @param userId - Authenticated user ID (for key scoping).
 * @param payload - The parsed request payload (for hash comparison).
 * @returns A discriminated union describing what action the caller should take.
 */
export async function checkIdempotencyKey(
  idempotencyKey: string | null,
  userId: string,
  payload: unknown
): Promise<IdempotencyCheckResult> {
  // Key is optional — callers without one proceed normally (no idempotency guarantee)
  if (!idempotencyKey) {
    return { type: "missing" };
  }

  if (!isValidIdempotencyKey(idempotencyKey)) {
    return { type: "invalid" };
  }

  const redisKey = buildIdempotencyRedisKey(userId, idempotencyKey);
  const payloadHash = hashPayload(payload);
  const redis = await getRedisClient();
  const stored = await redis.get(redisKey);

  if (stored) {
    let record: IdempotencyRecord;
    try {
      record = JSON.parse(stored) as IdempotencyRecord;
    } catch {
      // Corrupted record — treat as new request
      log.warn({ redisKey }, "[idempotency] Corrupted record, treating as new");
      await redis.del(redisKey);
      return { type: "new", idempotencyKey, payloadHash, redisKey };
    }

    if (record.payloadHash !== payloadHash) {
      log.warn({ redisKey }, "[idempotency] Payload mismatch — conflict");
      return { type: "conflict" };
    }

    log.info({ redisKey }, "[idempotency] Replay — returning cached response");
    return {
      type: "replay",
      status: record.status,
      body: JSON.parse(record.body),
    };
  }

  return { type: "new", idempotencyKey, payloadHash, redisKey };
}

/**
 * Store a response in Redis under the idempotency key.
 *
 * @param redisKey - Pre-built Redis key from `buildIdempotencyRedisKey`.
 * @param payloadHash - Hash of the original request payload.
 * @param status - HTTP status code of the response.
 * @param body - Response body object to cache.
 */
export async function storeIdempotencyResponse(
  redisKey: string,
  payloadHash: string,
  status: number,
  body: unknown
): Promise<void> {
  const record: IdempotencyRecord = {
    payloadHash,
    status,
    body: JSON.stringify(body),
  };
  const redis = await getRedisClient();
  await redis.set(redisKey, JSON.stringify(record), { EX: IDEMPOTENCY_TTL_SECONDS });
  log.info({ redisKey }, "[idempotency] Response cached");
}
