import { getRedisClient } from "@/lib/redis";
import { serverConfig } from "@/server/config";

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = "rate:NGN:USDC";
/** Primary cache TTL — rate is "fresh" for 60 s. */
const CACHE_TTL_SEC = 60;
/** Stale cache is written alongside the primary key and has a longer TTL. */
const STALE_CACHE_TTL_SEC = 3600; // 1 hour
/** Hard ceiling: reject any stale rate older than 30 minutes. */
const MAX_STALE_AGE_SEC = 1800; // 30 minutes
/** Key that stores the Unix timestamp when the stale value was written. */
const STALE_TIMESTAMP_KEY = `${CACHE_KEY}:stale:ts`;
/** Hardcoded last-resort rate — only used when no stale rate exists at all. */
const FALLBACK_RATE = 1600;
/** Locked rate per-gift TTL. */
const LOCKED_RATE_TTL_SEC = 300; // 5 minutes
/** Max tolerated slippage between lock time and claim time. */
const MAX_SLIPPAGE_PERCENT = 1;

/** Fetch timeout for each Horizon request (5 s). */
const FETCH_TIMEOUT_MS = 5_000;
/** Maximum number of retry attempts after the initial try (total 3 attempts). */
const MAX_RETRIES = 2;
/** Base delay for exponential backoff. */
const RETRY_BASE_DELAY_MS = 200;

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when a rate is stale beyond the configured maximum age policy. */
export class StaleRateError extends Error {
  readonly code = "STALE_RATE_EXCEEDED";
  constructor(ageSeconds: number) {
    super(
      `Exchange rate is stale by ${ageSeconds}s, which exceeds the ${MAX_STALE_AGE_SEC}s policy. ` +
        `Action: check Horizon and fallback provider connectivity.`
    );
    this.name = "StaleRateError";
  }
}

/** Thrown when a currency conversion cannot be performed. */
export class ConversionError extends Error {
  readonly code = "CONVERSION_FAILED";
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "ConversionError";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by {@link getExchangeRate}. */
export interface ExchangeRateResult {
  ngnPerUsdc: number;
  stale: boolean;
  source: "cache" | "horizon" | "fallback-provider" | "fallback";
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Wraps a fetch call with an AbortController-based timeout.
 * @param url - URL to fetch.
 * @param timeoutMs - Abort after this many milliseconds.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Bypass Next.js cache so we always go to the network
      next: { revalidate: 0 },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `fn` up to `maxRetries + 1` times with exponential backoff.
 * Only retries on transient errors; surfaces the last error on exhaustion.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number, baseDelayMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Providers ────────────────────────────────────────────────────────────────

/**
 * Primary provider: Stellar Horizon order book.
 * Fetches the first ask price for XLM/USDC (used as a proxy; replace with a
 * real NGN/USDC feed when available).
 */
async function fetchFromHorizon(): Promise<number> {
  const url =
    `${serverConfig.stellar.horizonUrl}/order_book` +
    `?selling_asset_type=native` +
    `&buying_asset_type=credit_alphanum4` +
    `&buying_asset_code=${serverConfig.usdc.assetCode}` +
    `&buying_asset_issuer=${serverConfig.usdc.issuer}` +
    `&limit=1`;

  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Horizon responded ${res.status}`);
  const data = await res.json();
  const price = parseFloat(data?.asks?.[0]?.price ?? "0");
  if (!price) throw new Error("No asks in Horizon order book");
  return price;
}

/**
 * Fallback provider: Coingecko public price API.
 * Returns approximate NGN/USDC rate. No API key required for low-frequency use.
 */
async function fetchFromFallbackProvider(): Promise<number> {
  // Coingecko: price of usd-coin in ngn
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=ngn";

  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Coingecko responded ${res.status}`);
  const data = await res.json();
  const price = data?.["usd-coin"]?.ngn;
  if (!price || typeof price !== "number" || price <= 0) {
    throw new Error("Coingecko returned no NGN price for USDC");
  }
  return price;
}

/**
 * Attempts to fetch a rate from a provider with bounded retries.
 * @param providerFn - A function that returns a fresh rate.
 */
async function fetchWithRetry(providerFn: () => Promise<number>): Promise<number> {
  return withRetry(providerFn, MAX_RETRIES, RETRY_BASE_DELAY_MS);
}

// ─── Stale cache helpers ──────────────────────────────────────────────────────

/**
 * Persists a fresh rate alongside a stale-fallback copy that survives the
 * primary TTL and a timestamp for age enforcement.
 */
async function cacheRate(redis: Awaited<ReturnType<typeof getRedisClient>>, rate: number): Promise<void> {
  await redis.setEx(CACHE_KEY, CACHE_TTL_SEC, String(rate));
  await redis.setEx(`${CACHE_KEY}:stale`, STALE_CACHE_TTL_SEC, String(rate));
  await redis.setEx(STALE_TIMESTAMP_KEY, STALE_CACHE_TTL_SEC, String(Math.floor(Date.now() / 1000)));
}

/**
 * Reads the stale cache and enforces the MAX_STALE_AGE_SEC policy.
 * Returns the stale rate if within policy, throws {@link StaleRateError} if too old,
 * or returns null if no stale entry exists.
 */
async function getValidStaleRate(
  redis: Awaited<ReturnType<typeof getRedisClient>>
): Promise<number | null> {
  const [staleStr, tsStr] = await Promise.all([
    redis.get(`${CACHE_KEY}:stale`),
    redis.get(STALE_TIMESTAMP_KEY),
  ]);

  if (!staleStr) return null;

  if (tsStr) {
    const writtenAt = parseInt(tsStr, 10);
    const ageSeconds = Math.floor(Date.now() / 1000) - writtenAt;
    if (ageSeconds > MAX_STALE_AGE_SEC) {
      throw new StaleRateError(ageSeconds);
    }
  }

  return parseFloat(staleStr);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the NGN/USDC exchange rate using a multi-layer resilience strategy:
 *
 * 1. **Cache hit** — fresh rate from Redis (TTL 60 s), returned immediately.
 * 2. **Horizon** — up to 3 attempts with exponential backoff and a 5 s timeout.
 * 3. **Fallback provider** — Coingecko, same retry policy, if Horizon fails.
 * 4. **Stale cache** — last known good rate, subject to a 30-minute age limit.
 * 5. **Hardcoded fallback** — 1 600 NGN/USDC, used only if no stale rate exists.
 *
 * @throws {StaleRateError} If the only available rate is stale beyond 30 minutes.
 * @returns An {@link ExchangeRateResult} with the rate, staleness flag, and source.
 */
export async function getExchangeRate(): Promise<ExchangeRateResult> {
  const redis = await getRedisClient();

  // ── 1. Cache hit ──────────────────────────────────────────────────────────
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    console.log("[exchange-rate] cache hit", { key: CACHE_KEY });
    return { ngnPerUsdc: parseFloat(cached), stale: false, source: "cache" };
  }

  console.log("[exchange-rate] cache miss — fetching fresh rate");

  // ── 2. Primary provider: Horizon ─────────────────────────────────────────
  try {
    const rate = await fetchWithRetry(fetchFromHorizon);
    await cacheRate(redis, rate);
    console.log("[exchange-rate] fetched from Horizon", { rate });
    return { ngnPerUsdc: rate, stale: false, source: "horizon" };
  } catch (horizonErr) {
    console.error("[exchange-rate] Horizon failed (all retries exhausted)", horizonErr);
  }

  // ── 3. Fallback provider: Coingecko ───────────────────────────────────────
  try {
    const rate = await fetchWithRetry(fetchFromFallbackProvider);
    await cacheRate(redis, rate);
    console.log("[exchange-rate] fetched from fallback provider (Coingecko)", { rate });
    return { ngnPerUsdc: rate, stale: false, source: "fallback-provider" };
  } catch (fallbackErr) {
    console.error("[exchange-rate] fallback provider failed (all retries exhausted)", fallbackErr);
  }

  // ── 4. Stale cache (with age enforcement) ────────────────────────────────
  // getValidStaleRate throws StaleRateError if the entry is too old — let it
  // propagate so callers know the rate cannot be trusted.
  const staleRate = await getValidStaleRate(redis);
  if (staleRate !== null) {
    console.warn("[exchange-rate] serving stale rate", { rate: staleRate });
    return { ngnPerUsdc: staleRate, stale: true, source: "cache" };
  }

  // ── 5. Hardcoded last-resort fallback ─────────────────────────────────────
  console.error("[exchange-rate] no stale rate available — using hardcoded fallback");
  return { ngnPerUsdc: FALLBACK_RATE, stale: true, source: "fallback" };
}

/**
 * Locks the current exchange rate for a gift, storing it in Redis for 5 minutes.
 * Call this at payment initiation time so slippage can be validated at claim time.
 *
 * @param giftId - The gift UUID to associate the locked rate with.
 * @returns The locked rate and its expiry Unix timestamp.
 * @throws {ConversionError} If a valid rate cannot be obtained.
 */
export async function lockExchangeRate(
  giftId: string
): Promise<{ lockedRate: number; expiresAt: number }> {
  let rateResult: ExchangeRateResult;
  try {
    rateResult = await getExchangeRate();
  } catch (err) {
    throw new ConversionError(
      `Cannot lock exchange rate for gift ${giftId}: rate is unavailable. ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
      { giftId, cause: String(err) }
    );
  }

  const redis = await getRedisClient();
  const expiresAt = Math.floor(Date.now() / 1000) + LOCKED_RATE_TTL_SEC;
  await redis.setEx(`rate:locked:${giftId}`, LOCKED_RATE_TTL_SEC, String(rateResult.ngnPerUsdc));
  return { lockedRate: rateResult.ngnPerUsdc, expiresAt };
}

/**
 * Validates that the current rate has not deviated more than MAX_SLIPPAGE_PERCENT
 * from the rate locked at payment initiation.
 *
 * @param giftId - The gift UUID whose locked rate to compare against.
 * @returns `{ valid: true }` if within tolerance, or `{ valid: false, reason }` otherwise.
 */
export async function validateSlippage(
  giftId: string
): Promise<{ valid: boolean; reason?: string }> {
  const redis = await getRedisClient();
  const lockedStr = await redis.get(`rate:locked:${giftId}`);

  if (!lockedStr) {
    return { valid: false, reason: "rate_expired" };
  }

  const lockedRate = parseFloat(lockedStr);

  let currentRate: number;
  try {
    const result = await getExchangeRate();
    currentRate = result.ngnPerUsdc;
  } catch (err) {
    return {
      valid: false,
      reason: `rate_unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const deviation = (Math.abs(currentRate - lockedRate) / lockedRate) * 100;

  if (deviation > MAX_SLIPPAGE_PERCENT) {
    return {
      valid: false,
      reason: `rate_deviated: locked=${lockedRate}, current=${currentRate}, deviation=${deviation.toFixed(2)}%`,
    };
  }

  return { valid: true };
}
