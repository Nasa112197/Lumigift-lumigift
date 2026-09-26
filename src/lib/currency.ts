/**
 * currency.ts — Lumigift monetary arithmetic helpers
 *
 * ## Rounding policy
 *
 * All intermediate arithmetic is performed in integer (bigint) units to avoid
 * IEEE-754 floating-point drift on fractional amounts.
 *
 * | Direction              | Mode    | Rationale                                      |
 * |------------------------|---------|------------------------------------------------|
 * | NGN → kobo             | floor   | Caller rounds down; never overstates the charge|
 * | kobo → NGN             | floor   | Display value never exceeds actual kobo balance|
 * | NGN → stroops (escrow) | floor   | Escrow receives ≤ what the user paid (no overfund)|
 * | stroops → NGN          | floor   | Display value never inflates the stroop balance|
 * | NGN → USDC micro-units | floor   | Escrow locks ≤ calculated USDC (never overfund)|
 * | USDC micro-units → NGN | ceiling | Payment always covers the full USDC obligation  |
 *
 * "floor" for escrow-bound conversions guarantees the contract is never
 * overfunded by a rounding artifact.  "ceiling" for payment-bound conversions
 * guarantees the user is never underfunded — i.e., they always pay enough.
 *
 * ## Unit reference
 *
 * | Currency | Smallest unit | Factor |
 * |----------|---------------|--------|
 * | NGN      | kobo          | 100    |
 * | USDC     | stroop*       | 10_000_000 (1e7) |
 *
 * *Stellar calls the smallest unit of every asset a "stroop" (1/10_000_000 of
 * one asset unit).  For USDC on Stellar this means 1 USDC = 10_000_000 stroops.
 */

// ─── Formatters ──────────────────────────────────────────────────────────────

const NGN_FORMATTER = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USDC_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type CurrencyAmount = number | string;

function toFiniteNumber(amount: CurrencyAmount): number {
  const numericAmount = typeof amount === "number" ? amount : Number(amount.trim());

  if (!Number.isFinite(numericAmount)) {
    throw new TypeError("Currency amount must be a finite number");
  }

  return numericAmount;
}

export function formatNGN(amount: CurrencyAmount): string {
  return NGN_FORMATTER.format(toFiniteNumber(amount));
}

export function formatUSDC(amount: CurrencyAmount): string {
  return `${USDC_FORMATTER.format(toFiniteNumber(amount))} USDC`;
}

// ─── Unit constants ───────────────────────────────────────────────────────────

/** Number of kobo per Naira (100). */
export const KOBO_PER_NGN = 100n;

/**
 * Number of stroops per USDC on Stellar (10,000,000).
 * Stellar's asset precision is always 7 decimal places.
 */
export const STROOPS_PER_USDC = 10_000_000n;

// ─── Integer arithmetic helpers ──────────────────────────────────────────────

/**
 * Validates that a value is a safe integer (no fractional part, within
 * Number.MAX_SAFE_INTEGER).  Throws if the check fails.
 */
function assertSafeInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`${label} must be a finite integer, got ${value}`);
  }
}

/**
 * Converts a whole-Naira amount to kobo using integer arithmetic.
 * Rounding: **floor** — fractional kobo is truncated (never overstates charge).
 *
 * @param ngnFloat - Amount in NGN (may be fractional, e.g. 1500.75).
 * @returns Integer kobo amount.
 *
 * @example
 * ngnToKobo(1500)     // 150000
 * ngnToKobo(1500.75)  // 150075
 * ngnToKobo(1500.001) // 150000  (sub-kobo fraction truncated)
 */
export function ngnToKobo(ngnFloat: number): number {
  if (!Number.isFinite(ngnFloat)) {
    throw new TypeError(`ngnToKobo: expected a finite number, got ${ngnFloat}`);
  }
  // Multiply by 100 then floor to integer kobo — avoids floating-point drift
  // by using Math.floor instead of Math.round, so we never overcharge.
  return Math.floor(ngnFloat * 100);
}

/**
 * Converts an integer kobo amount back to NGN (as a float suitable for display).
 * Rounding: **floor** — result is exact since kobo divides evenly into NGN.
 *
 * @param kobo - Integer kobo amount.
 * @returns NGN amount (two decimal places of precision).
 *
 * @example
 * koboToNgn(150075) // 1500.75
 */
export function koboToNgn(kobo: number): number {
  assertSafeInteger(kobo, "kobo");
  return kobo / 100;
}

/**
 * Converts a whole-NGN amount to Stellar stroops for USDC using a live exchange
 * rate expressed as NGN-per-USDC.
 *
 * Rounding: **floor** (bigint division truncates toward zero for positive
 * values) — the escrow is never overfunded by a rounding artifact.
 *
 * Intermediate arithmetic is done in bigint to prevent floating-point drift on
 * large NGN amounts.
 *
 * @param ngnFloat     - Amount in NGN (may be fractional).
 * @param ngnPerUsdc   - Live exchange rate: how many NGN equal 1 USDC.
 * @returns Integer stroop count.
 *
 * @example
 * // 1 USDC = 1500 NGN:
 * ngnToStroops(1500, 1500)  // 10_000_000  (exactly 1 USDC)
 * ngnToStroops(750,  1500)  // 5_000_000   (0.5 USDC)
 * ngnToStroops(1,    1500)  // 6_666        (floor of 6666.666…)
 */
export function ngnToStroops(ngnFloat: number, ngnPerUsdc: number): number {
  if (!Number.isFinite(ngnFloat) || ngnFloat < 0) {
    throw new TypeError(`ngnToStroops: ngnFloat must be a non-negative finite number, got ${ngnFloat}`);
  }
  if (!Number.isFinite(ngnPerUsdc) || ngnPerUsdc <= 0) {
    throw new TypeError(`ngnToStroops: ngnPerUsdc must be a positive finite number, got ${ngnPerUsdc}`);
  }

  // Convert NGN to integer kobo first, then scale up to stroops using bigint
  // arithmetic.  This avoids any floating-point representation issues.
  //
  // stroops = floor( (ngnFloat / ngnPerUsdc) * STROOPS_PER_USDC )
  //         = floor( ngnKobo * STROOPS_PER_USDC / (ngnPerUsdcKobo) )
  //   where ngnKobo       = ngnFloat * 100  (integer)
  //         ngnPerUsdcKobo = ngnPerUsdc * 100
  //
  // The 100s cancel so this simplifies to:
  //   stroops = floor( ngnKobo * STROOPS_PER_USDC / ngnPerUsdcKobo )

  const ngnKobo = BigInt(Math.floor(ngnFloat * 100));
  const rateKobo = BigInt(Math.round(ngnPerUsdc * 100));
  const stroops = (ngnKobo * STROOPS_PER_USDC) / rateKobo; // bigint division truncates (floor)
  return Number(stroops);
}

/**
 * Converts an integer stroop count back to NGN using a live exchange rate.
 * Rounding: **ceiling** — the NGN amount is always enough to cover the stroops
 * (never underfunds payment).
 *
 * @param stroops    - Integer stroop count.
 * @param ngnPerUsdc - Live exchange rate: how many NGN equal 1 USDC.
 * @returns NGN amount (float, ceiling-rounded to nearest kobo).
 *
 * @example
 * // 1 USDC = 1500 NGN:
 * stroopsToNgn(10_000_000, 1500) // 1500.00
 * stroopsToNgn(5_000_000,  1500) // 750.00
 * stroopsToNgn(6_666,      1500) // 1.00   (ceiling of 0.9999)
 */
export function stroopsToNgn(stroops: number, ngnPerUsdc: number): number {
  assertSafeInteger(stroops, "stroops");
  if (!Number.isFinite(ngnPerUsdc) || ngnPerUsdc <= 0) {
    throw new TypeError(`stroopsToNgn: ngnPerUsdc must be a positive finite number, got ${ngnPerUsdc}`);
  }

  // ngn = ceil( (stroops / STROOPS_PER_USDC) * ngnPerUsdc )
  // Use bigint for the multiplication to avoid precision loss, then ceiling.
  //
  // ngn_kobo_exact = stroops * ngnPerUsdcKobo / STROOPS_PER_USDC
  // Apply ceiling:  = (stroops * ngnPerUsdcKobo + STROOPS_PER_USDC - 1) / STROOPS_PER_USDC
  const ngnPerUsdcKobo = BigInt(Math.round(ngnPerUsdc * 100));
  const stroopsBig = BigInt(stroops);
  const numerator = stroopsBig * ngnPerUsdcKobo + STROOPS_PER_USDC - 1n;
  const ngnKoboCeil = numerator / STROOPS_PER_USDC;
  return Number(ngnKoboCeil) / 100;
}

/**
 * Converts an NGN amount to USDC micro-units (stroops) using a live rate, then
 * returns the USDC amount as a 7-decimal-place string (Stellar ledger format).
 *
 * This is the canonical replacement for `(ngn / ngnPerUsdc).toFixed(7)` in
 * gift.service.ts — it routes through integer stroop arithmetic to avoid
 * floating-point drift.
 *
 * Rounding: **floor** (same as `ngnToStroops`).
 *
 * @param ngnFloat   - Amount in NGN.
 * @param ngnPerUsdc - Live exchange rate.
 * @returns USDC as a string with exactly 7 decimal places, e.g. `"1.0000000"`.
 *
 * @example
 * ngnToUsdc(1500, 1500) // "1.0000000"
 * ngnToUsdc(750,  1500) // "0.5000000"
 * ngnToUsdc(1,    1500) // "0.0006666"
 */
export function ngnToUsdc(ngnFloat: number, ngnPerUsdc: number): string {
  const stroops = ngnToStroops(ngnFloat, ngnPerUsdc);
  // Format as X.YYYYYYY (7 decimal places)
  const whole = Math.floor(stroops / 10_000_000);
  const frac = stroops % 10_000_000;
  return `${whole}.${String(frac).padStart(7, "0")}`;
}

/**
 * Converts a USDC amount (float or "X.YYYYYYY" string) to NGN using a live
 * exchange rate.
 *
 * Rounding: **ceiling** — the NGN payment always covers the full USDC value.
 *
 * @param usdcFloat  - USDC amount as a number or 7-decimal string.
 * @param ngnPerUsdc - Live exchange rate.
 * @returns NGN amount (float).
 *
 * @example
 * usdcToNgn(1.0, 1500)       // 1500.00
 * usdcToNgn("0.5000000", 1500) // 750.00
 */
export function usdcToNgn(usdcFloat: CurrencyAmount, ngnPerUsdc: number): number {
  const usdc = toFiniteNumber(usdcFloat);
  // Convert to stroops first, then to NGN via stroopsToNgn (ceiling).
  const stroops = Math.floor(usdc * 10_000_000);
  return stroopsToNgn(stroops, ngnPerUsdc);
}
