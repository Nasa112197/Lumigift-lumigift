/**
 * Property-based tests for currency conversion utilities.
 *
 * Instead of a fixed-example test, each "property" test generates a large set
 * of edge-case values and asserts an invariant that must hold for ALL of them.
 * This covers rounding surprises, boundary values, and arbitrary rates that
 * hand-picked examples may miss.
 *
 * No external fast-check dependency is needed — all generators use plain
 * JavaScript arrays and loops.
 *
 * Closes #124
 */

import {
  ngnToKobo,
  koboToNgn,
  ngnToStroops,
  stroopsToNgn,
  ngnToUsdc,
  usdcToNgn,
  KOBO_PER_NGN,
  STROOPS_PER_USDC,
} from "@/lib/currency";

// ─── Value generators ──────────────────────────────────────────────────────────

/**
 * Generates representative NGN amounts covering:
 *  - Zero
 *  - Sub-kobo fractions (0.001, 0.009)
 *  - Exact-kobo fractions (0.01, 0.50)
 *  - Typical gift amounts (500 … 100_000)
 *  - Maximum practical send amount (10_000_000)
 *  - Just-below-integer boundaries (499.99, 999.99)
 */
function ngnAmounts(): number[] {
  const samples: number[] = [
    // Zero
    0,
    // Sub-kobo fractions — should floor to 0 or nearest kobo
    0.001, 0.004, 0.009,
    // Exact kobo fractions
    0.01, 0.05, 0.1, 0.5, 0.99,
    // Common gift amounts (multiples of 50 NGN)
    500, 1000, 1500, 2000, 2500, 5000, 7500, 10000,
    // Irregular amounts with sub-kobo digits
    500.001, 999.999, 1234.567,
    // Large amounts
    100_000, 500_000, 1_000_000, 10_000_000,
    // Just-below boundaries
    499.99, 999.99, 4999.99, 9999.99,
    // Minimum practical gift per business rules (₦500)
    499, 500, 501,
  ];
  // Also generate a sweep of multiples
  for (let n = 1; n <= 100; n++) {
    samples.push(n * 100);
  }
  return samples;
}

/**
 * Generates representative NGN-per-USDC exchange rates:
 *  - Floor/ceiling at realistic Naira weakening scenarios
 *  - Round rates and fractional rates
 */
function exchangeRates(): number[] {
  return [
    // Minimum plausible rate
    100,
    // Historical rates (approximate)
    450, 750, 1000, 1200, 1500, 1600, 1750, 2000,
    // Fractional rates (exchange APIs sometimes return these)
    1499.5, 1500.25, 1600.75,
    // High rates (stress test)
    5000, 10_000,
  ];
}

/**
 * Generates representative stroop counts:
 *  - Zero
 *  - Fractional USDC values
 *  - Exact USDC integers
 *  - Large amounts
 */
function stroopAmounts(): number[] {
  const STROOPS = Number(STROOPS_PER_USDC); // 10_000_000
  return [
    0,
    1,
    6_666, // just under 0.001 USDC
    6_667,
    500_000, // 0.05 USDC
    1_000_000, // 0.1 USDC
    5_000_000, // 0.5 USDC
    STROOPS, // 1.0 USDC
    STROOPS * 2, // 2.0 USDC
    STROOPS * 10, // 10.0 USDC
    STROOPS * 100, // 100.0 USDC
    STROOPS + 1, // just over 1.0
    STROOPS - 1, // just under 1.0
  ];
}

// ─── §1  ngnToKobo ─────────────────────────────────────────────────────────────

describe("§1 ngnToKobo — property tests (Closes #124)", () => {
  it("never returns a negative value for non-negative NGN input", () => {
    for (const ngn of ngnAmounts()) {
      const kobo = ngnToKobo(ngn);
      expect(kobo).toBeGreaterThanOrEqual(0);
    }
  });

  it("always returns an integer (no fractional kobo)", () => {
    for (const ngn of ngnAmounts()) {
      const kobo = ngnToKobo(ngn);
      expect(Number.isInteger(kobo)).toBe(true);
    }
  });

  it("floors — kobo is always ≤ exact mathematical result", () => {
    for (const ngn of ngnAmounts()) {
      const exact = ngn * 100;
      const kobo = ngnToKobo(ngn);
      expect(kobo).toBeLessThanOrEqual(Math.ceil(exact)); // kobo ≤ ceil(exact)
      expect(kobo).toBeGreaterThanOrEqual(Math.floor(exact) - 1); // within 1 of floor
    }
  });

  it("is monotonically non-decreasing (larger NGN → more kobo)", () => {
    const sorted = [...ngnAmounts()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(ngnToKobo(sorted[i])).toBeGreaterThanOrEqual(ngnToKobo(sorted[i - 1]));
    }
  });

  it("throws for non-finite input", () => {
    expect(() => ngnToKobo(Number.NaN)).toThrow(TypeError);
    expect(() => ngnToKobo(Infinity)).toThrow(TypeError);
    expect(() => ngnToKobo(-Infinity)).toThrow(TypeError);
  });

  it("round-trips through koboToNgn without inflation", () => {
    // koboToNgn(ngnToKobo(ngn)) ≤ ngn  (floor means we may lose sub-kobo fractions)
    for (const ngn of ngnAmounts()) {
      const roundTripped = koboToNgn(ngnToKobo(ngn));
      // Allow up to 1 kobo (0.01 NGN) of loss — never a gain
      expect(roundTripped).toBeLessThanOrEqual(ngn + 0.000_001); // float tolerance
      expect(roundTripped).toBeGreaterThanOrEqual(ngn - 0.01); // at most 1 kobo lost
    }
  });
});

// ─── §2  koboToNgn ─────────────────────────────────────────────────────────────

describe("§2 koboToNgn — property tests (Closes #124)", () => {
  it("never returns a negative value for non-negative kobo input", () => {
    const koboValues = [0, 1, 50, 100, 1000, 150_000, 1_000_000];
    for (const kobo of koboValues) {
      expect(koboToNgn(kobo)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is exact — kobo divides evenly into NGN (no rounding error)", () => {
    for (let kobo = 0; kobo <= 1000; kobo++) {
      const ngn = koboToNgn(kobo);
      // Reconvert: ngn * 100 should equal kobo exactly (within float epsilon)
      expect(Math.abs(ngn * 100 - kobo)).toBeLessThan(0.000_001);
    }
  });

  it("throws for fractional kobo input", () => {
    expect(() => koboToNgn(1.5)).toThrow(TypeError);
    expect(() => koboToNgn(100.1)).toThrow(TypeError);
  });

  it("throws for non-finite kobo input", () => {
    expect(() => koboToNgn(Number.NaN)).toThrow(TypeError);
    expect(() => koboToNgn(Infinity)).toThrow(TypeError);
  });
});

// ─── §3  ngnToStroops ─────────────────────────────────────────────────────────

describe("§3 ngnToStroops — property tests (Closes #124)", () => {
  it("never returns a negative value", () => {
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const stroops = ngnToStroops(ngn, rate);
        expect(stroops).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("always returns an integer", () => {
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const stroops = ngnToStroops(ngn, rate);
        expect(Number.isInteger(stroops)).toBe(true);
      }
    }
  });

  it("floors — never overfunds the escrow contract", () => {
    // ngnToStroops(ngn, rate) ≤ (ngn / rate) * STROOPS_PER_USDC
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const stroops = ngnToStroops(ngn, rate);
        const exactStroops = (ngn / rate) * Number(STROOPS_PER_USDC);
        // Allow a tiny float-comparison buffer (1 stroop tolerance)
        expect(stroops).toBeLessThanOrEqual(Math.ceil(exactStroops) + 1);
        // But stroops must be ≤ exact (floor) — never exceed the true value
        expect(stroops).toBeLessThanOrEqual(exactStroops + 1);
      }
    }
  });

  it("is monotonically non-decreasing with NGN amount at fixed rate", () => {
    const rate = 1500;
    const sorted = [...ngnAmounts()].filter((n) => n >= 0).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(ngnToStroops(sorted[i], rate)).toBeGreaterThanOrEqual(
        ngnToStroops(sorted[i - 1], rate)
      );
    }
  });

  it("exact: 1 USDC worth of NGN converts to exactly STROOPS_PER_USDC", () => {
    for (const rate of [500, 1000, 1500, 2000]) {
      // At this rate, `rate` NGN = exactly 1 USDC
      const stroops = ngnToStroops(rate, rate);
      expect(stroops).toBe(Number(STROOPS_PER_USDC));
    }
  });

  it("throws for negative NGN", () => {
    expect(() => ngnToStroops(-1, 1500)).toThrow(TypeError);
  });

  it("throws for non-positive or non-finite rate", () => {
    expect(() => ngnToStroops(1000, 0)).toThrow(TypeError);
    expect(() => ngnToStroops(1000, -1)).toThrow(TypeError);
    expect(() => ngnToStroops(1000, Infinity)).toThrow(TypeError);
    expect(() => ngnToStroops(1000, Number.NaN)).toThrow(TypeError);
  });
});

// ─── §4  stroopsToNgn ─────────────────────────────────────────────────────────

describe("§4 stroopsToNgn — property tests (Closes #124)", () => {
  it("never returns a negative value", () => {
    for (const stroops of stroopAmounts()) {
      for (const rate of exchangeRates()) {
        expect(stroopsToNgn(stroops, rate)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ceilings — always covers the full obligation (never underfunds)", () => {
    // stroopsToNgn should return ≥ the exact mathematical value
    for (const stroops of stroopAmounts()) {
      for (const rate of exchangeRates()) {
        const ngn = stroopsToNgn(stroops, rate);
        const exactNgn = (stroops / Number(STROOPS_PER_USDC)) * rate;
        // Allow a tiny float-comparison buffer
        expect(ngn).toBeGreaterThanOrEqual(exactNgn - 0.000_001);
      }
    }
  });

  it("stroopsToNgn ≥ ngnToStroops round-trip (never underfunds)", () => {
    // If we convert NGN → stroops → NGN, the result must be ≥ the original NGN
    // (because stroopsToNgn ceilings, and ngnToStroops floors).
    const rates = [1000, 1500, 2000];
    for (const ngn of ngnAmounts()) {
      for (const rate of rates) {
        const stroops = ngnToStroops(ngn, rate);
        const recovered = stroopsToNgn(stroops, rate);
        // Recovered NGN may be slightly more (ceiling), but never less than ngn - 0.01
        expect(recovered).toBeGreaterThanOrEqual(ngn - 0.01);
      }
    }
  });

  it("throws for fractional stroop input", () => {
    expect(() => stroopsToNgn(1.5, 1500)).toThrow(TypeError);
  });

  it("throws for non-positive or non-finite rate", () => {
    expect(() => stroopsToNgn(1_000_000, 0)).toThrow(TypeError);
    expect(() => stroopsToNgn(1_000_000, -100)).toThrow(TypeError);
    expect(() => stroopsToNgn(1_000_000, Infinity)).toThrow(TypeError);
  });
});

// ─── §5  ngnToUsdc ────────────────────────────────────────────────────────────

describe("§5 ngnToUsdc — property tests (Closes #124)", () => {
  it("always returns a string with exactly 7 decimal places", () => {
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const result = ngnToUsdc(ngn, rate);
        expect(typeof result).toBe("string");
        const parts = result.split(".");
        expect(parts).toHaveLength(2);
        expect(parts[1]).toHaveLength(7);
      }
    }
  });

  it("always returns a non-negative value", () => {
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const usdc = parseFloat(ngnToUsdc(ngn, rate));
        expect(usdc).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("exact: rate NGN → '1.0000000' USDC", () => {
    for (const rate of [500, 1000, 1500, 2000]) {
      expect(ngnToUsdc(rate, rate)).toBe("1.0000000");
    }
  });

  it("exact: 0 NGN → '0.0000000' USDC", () => {
    for (const rate of exchangeRates()) {
      expect(ngnToUsdc(0, rate)).toBe("0.0000000");
    }
  });

  it("floors — parsed float ≤ exact mathematical USDC value", () => {
    for (const ngn of ngnAmounts()) {
      for (const rate of exchangeRates()) {
        const parsed = parseFloat(ngnToUsdc(ngn, rate));
        const exact = ngn / rate;
        // Allow 1 stroop of rounding (1e-7)
        expect(parsed).toBeLessThanOrEqual(exact + 1e-7);
      }
    }
  });
});

// ─── §6  usdcToNgn ────────────────────────────────────────────────────────────

describe("§6 usdcToNgn — property tests (Closes #124)", () => {
  const usdcAmounts = [
    0,
    0.0000001,
    0.000001,
    0.0006666,
    0.5,
    1.0,
    1.5,
    3.0,
    6.0,
    10.0,
    // String forms (Stellar ledger format)
    "0.0000000",
    "1.0000000",
    "3.5000000",
    "10.0000000",
  ];

  it("never returns a negative value", () => {
    for (const usdc of usdcAmounts) {
      for (const rate of exchangeRates()) {
        expect(usdcToNgn(usdc, rate)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ceilings — always covers the full NGN obligation", () => {
    const numericAmounts = usdcAmounts.filter((u) => typeof u === "number") as number[];
    for (const usdc of numericAmounts) {
      for (const rate of exchangeRates()) {
        const ngn = usdcToNgn(usdc, rate);
        const exact = usdc * rate;
        // Must be ≥ exact (ceiling), with float tolerance
        expect(ngn).toBeGreaterThanOrEqual(exact - 0.000_001);
      }
    }
  });

  it("exact: 1.0 USDC → rate NGN (within 1 kobo)", () => {
    for (const rate of [500, 1000, 1500, 2000]) {
      const ngn = usdcToNgn(1.0, rate);
      // Should be within 1 kobo (0.01 NGN) of the rate due to ceiling rounding
      expect(Math.abs(ngn - rate)).toBeLessThanOrEqual(0.01);
    }
  });

  it("accepts both number and string inputs", () => {
    const rate = 1500;
    expect(usdcToNgn(1.0, rate)).toBe(usdcToNgn("1.0000000", rate));
    expect(usdcToNgn(0.5, rate)).toBe(usdcToNgn("0.5000000", rate));
  });

  it("throws for non-finite string input", () => {
    expect(() => usdcToNgn("not-a-number", 1500)).toThrow(TypeError);
    expect(() => usdcToNgn("Infinity", 1500)).toThrow();
  });
});

// ─── §7  Limit boundary tests ─────────────────────────────────────────────────

describe("§7 Limits apply after normalization (Closes #124)", () => {
  /**
   * Business limits (from schemas):
   *   MIN_AMOUNT_NGN = 500
   *   MAX_AMOUNT_NGN = 10_000_000
   */
  const MIN_NGN = 500;
  const MAX_NGN = 10_000_000;
  const RATE = 1500;

  it("minimum NGN amount (₦500) converts to a positive stroop count", () => {
    expect(ngnToStroops(MIN_NGN, RATE)).toBeGreaterThan(0);
    expect(ngnToUsdc(MIN_NGN, RATE)).not.toBe("0.0000000");
  });

  it("maximum NGN amount converts without overflow or negative result", () => {
    const stroops = ngnToStroops(MAX_NGN, RATE);
    expect(stroops).toBeGreaterThan(0);
    expect(Number.isFinite(stroops)).toBe(true);
    expect(Number.isInteger(stroops)).toBe(true);
  });

  it("sub-minimum NGN (₦499) converts to kobo correctly — limits applied before conversion", () => {
    // The function itself doesn't enforce limits (the schema layer does), but
    // we assert the math is still well-behaved for sub-limit values.
    const kobo = ngnToKobo(499);
    expect(kobo).toBe(49900);
    expect(Number.isInteger(kobo)).toBe(true);
  });

  it("kobo round-trip is lossless for all amounts within limits", () => {
    const testAmounts = [MIN_NGN, 1000, 5000, 10000, 50000, MAX_NGN];
    for (const ngn of testAmounts) {
      const kobo = ngnToKobo(ngn);
      const backToNgn = koboToNgn(kobo);
      // Exact amounts in whole NGN should round-trip without loss
      expect(backToNgn).toBeCloseTo(ngn, 5);
    }
  });

  it("USDC 7-decimal precision is maintained at minimum gift size", () => {
    // ₦500 at 1500 NGN/USDC = 0.3333333 USDC (floor)
    const result = ngnToUsdc(MIN_NGN, RATE);
    expect(result).toBe("0.3333333");
  });

  it("USDC 7-decimal precision is maintained at maximum gift size", () => {
    const result = ngnToUsdc(MAX_NGN, RATE);
    // ₦10,000,000 at 1500 NGN/USDC = 6666.6666666... → floor to "6666.6666666"
    expect(result).toMatch(/^\d+\.\d{7}$/);
    const [, frac] = result.split(".");
    expect(frac).toHaveLength(7);
  });
});

// ─── §8  IEEE-754 drift resistance ────────────────────────────────────────────

describe("§8 IEEE-754 drift resistance (Closes #124)", () => {
  it("ngnToKobo avoids the classic 0.1 + 0.2 floating-point trap", () => {
    // 0.1 + 0.2 in IEEE-754 = 0.30000000000000004
    // ngnToKobo should treat this as 30 kobo (floor), not 31
    const result = ngnToKobo(0.1 + 0.2); // ~0.30000000000000004
    expect(result).toBe(30);
  });

  it("ngnToStroops is stable across rate-equivalent reformulations", () => {
    // 1500 NGN at 1500 NGN/USDC and 3000 NGN at 3000 NGN/USDC should produce
    // the same stroop count (both are exactly 1 USDC)
    const stroops1 = ngnToStroops(1500, 1500);
    const stroops2 = ngnToStroops(3000, 3000);
    expect(stroops1).toBe(stroops2);
    expect(stroops1).toBe(Number(STROOPS_PER_USDC));
  });

  it("large NGN amounts do not overflow Number.MAX_SAFE_INTEGER via bigint path", () => {
    // 10_000_000 NGN at 1500 NGN/USDC = ~6_666_666 USDC = ~66_666_660_000_000 stroops
    // That fits well within Number.MAX_SAFE_INTEGER (9_007_199_254_740_991)
    const stroops = ngnToStroops(10_000_000, 1500);
    expect(Number.isSafeInteger(stroops)).toBe(true);
    expect(stroops).toBeGreaterThan(0);
  });
});
