/**
 * Form Validation Parity Tests (#45)
 *
 * Ensures UI validation matches Zod schema rules for:
 *  - amounts (boundary values: exactly at min/max, one below/above)
 *  - phone numbers (normalisation + rejection paths)
 *  - dates (past, now-ish, future)
 *  - messages (empty/optional, max-length boundary)
 *  - recipientName (min-length boundary)
 *  - recipientEmail (optional but validated when present)
 *  - OTP length
 *  - Stellar key length
 */

import {
  createGiftSchema,
  verifyOtpSchema,
  claimGiftSchema,
  type CreateGiftInput,
} from "../schemas";

// Helper: build a valid createGiftSchema input, allowing partial overrides.
function validGiftInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    recipientPhone: "+2348012345678",
    recipientName: "Amara",
    amountNgn: 1000,
    unlockAt: new Date(Date.now() + 86_400_000).toISOString(), // tomorrow
    paymentProvider: "paystack",
    ...overrides,
  };
}

// ─── createGiftSchema ──────────────────────────────────────────────────────────

describe("createGiftSchema — amount boundary values", () => {
  it("accepts the exact minimum amount (500)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ amountNgn: 500 }));
    expect(result.success).toBe(true);
  });

  it("rejects one below the minimum (499)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ amountNgn: 499 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /minimum/i.test(m))).toBe(true);
    }
  });

  it("accepts the exact maximum amount (500 000)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ amountNgn: 500_000 }));
    expect(result.success).toBe(true);
  });

  it("rejects one above the maximum (500 001)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ amountNgn: 500_001 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /maximum/i.test(m))).toBe(true);
    }
  });

  it("rejects zero", () => {
    expect(createGiftSchema.safeParse(validGiftInput({ amountNgn: 0 })).success).toBe(false);
  });

  it("rejects negative amounts", () => {
    expect(createGiftSchema.safeParse(validGiftInput({ amountNgn: -1 })).success).toBe(false);
  });
});

describe("createGiftSchema — recipientName boundary values", () => {
  it("accepts a 2-character name (exact minimum)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ recipientName: "Jo" }));
    expect(result.success).toBe(true);
  });

  it("rejects a 1-character name (one below minimum)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ recipientName: "J" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /2 characters/i.test(m))).toBe(true);
    }
  });

  it("rejects an empty name", () => {
    expect(createGiftSchema.safeParse(validGiftInput({ recipientName: "" })).success).toBe(false);
  });

  it("accepts a very long name (no upper limit defined)", () => {
    const longName = "A".repeat(200);
    const result = createGiftSchema.safeParse(validGiftInput({ recipientName: longName }));
    expect(result.success).toBe(true);
  });
});

describe("createGiftSchema — message boundary values", () => {
  it("accepts an undefined message (optional field)", () => {
    const input = validGiftInput();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (input as any).message;
    expect(createGiftSchema.safeParse(input).success).toBe(true);
  });

  it("accepts an empty string message (optional field)", () => {
    // Zod optional() allows undefined; an empty string is not the same as
    // undefined but should pass since there is no .min() constraint.
    const result = createGiftSchema.safeParse(validGiftInput({ message: "" }));
    expect(result.success).toBe(true);
  });

  it("accepts a message of exactly 500 characters (boundary)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ message: "x".repeat(500) }));
    expect(result.success).toBe(true);
  });

  it("rejects a message of 501 characters (one over limit)", () => {
    const result = createGiftSchema.safeParse(validGiftInput({ message: "x".repeat(501) }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /500/i.test(m))).toBe(true);
    }
  });
});

describe("createGiftSchema — unlockAt date validation", () => {
  it("rejects a date in the past", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(createGiftSchema.safeParse(validGiftInput({ unlockAt: past })).success).toBe(false);
  });

  it("accepts a date 1 second from now", () => {
    const near = new Date(Date.now() + 1000).toISOString();
    expect(createGiftSchema.safeParse(validGiftInput({ unlockAt: near })).success).toBe(true);
  });

  it("rejects a non-ISO-8601 date string", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ unlockAt: "25/12/2025" })).success
    ).toBe(false);
  });
});

describe("createGiftSchema — recipientEmail (optional, validated when present)", () => {
  it("accepts a valid email", () => {
    const result = createGiftSchema.safeParse(
      validGiftInput({ recipientEmail: "amara@example.com" })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = createGiftSchema.safeParse(
      validGiftInput({ recipientEmail: "not-an-email" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /email/i.test(m))).toBe(true);
    }
  });

  it("accepts absence of recipientEmail", () => {
    const input = validGiftInput();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (input as any).recipientEmail;
    expect(createGiftSchema.safeParse(input).success).toBe(true);
  });
});

describe("createGiftSchema — phone normalisation parity", () => {
  const cases: { input: string; expected: string }[] = [
    { input: "+2348012345678", expected: "+2348012345678" },
    { input: "2348012345678", expected: "+2348012345678" },
    { input: "08012345678", expected: "+2348012345678" },
    { input: "8012345678", expected: "+2348012345678" },
  ];

  it.each(cases)("normalises '$input' → '$expected'", ({ input, expected }) => {
    const result = createGiftSchema.safeParse(validGiftInput({ recipientPhone: input }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as CreateGiftInput).recipientPhone).toBe(expected);
    }
  });

  it("rejects short arbitrary numbers", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ recipientPhone: "123" })).success
    ).toBe(false);
  });

  it("rejects alphabetic input", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ recipientPhone: "abcde" })).success
    ).toBe(false);
  });

  it("rejects an excessively long number", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ recipientPhone: "+12345678901234567890" }))
        .success
    ).toBe(false);
  });
});

describe("createGiftSchema — paymentProvider enum", () => {
  it("accepts 'paystack'", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ paymentProvider: "paystack" })).success
    ).toBe(true);
  });

  it("accepts 'stripe'", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ paymentProvider: "stripe" })).success
    ).toBe(true);
  });

  it("rejects unknown provider", () => {
    expect(
      createGiftSchema.safeParse(validGiftInput({ paymentProvider: "flutterwave" })).success
    ).toBe(false);
  });
});

// ─── verifyOtpSchema ───────────────────────────────────────────────────────────

describe("verifyOtpSchema — OTP length boundary values", () => {
  function validOtpInput(overrides: Partial<Record<string, unknown>> = {}) {
    return { phone: "+2348012345678", otp: "123456", ...overrides };
  }

  it("accepts exactly 6 digits", () => {
    expect(verifyOtpSchema.safeParse(validOtpInput()).success).toBe(true);
  });

  it("rejects 5 digits (one short)", () => {
    expect(verifyOtpSchema.safeParse(validOtpInput({ otp: "12345" })).success).toBe(false);
  });

  it("rejects 7 digits (one over)", () => {
    expect(verifyOtpSchema.safeParse(validOtpInput({ otp: "1234567" })).success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(verifyOtpSchema.safeParse(validOtpInput({ otp: "" })).success).toBe(false);
  });

  it("normalises phone like createGiftSchema", () => {
    const result = verifyOtpSchema.safeParse(validOtpInput({ phone: "08012345678" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("+2348012345678");
    }
  });
});

// ─── claimGiftSchema ───────────────────────────────────────────────────────────

describe("claimGiftSchema — Stellar key length boundary values", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440000";
  const key56 = "G".padEnd(56, "A"); // 56 characters — valid length

  it("accepts a 56-character Stellar key", () => {
    expect(claimGiftSchema.safeParse({ giftId: validUuid, recipientStellarKey: key56 }).success).toBe(true);
  });

  it("rejects a 55-character key (one short)", () => {
    const key55 = "G".padEnd(55, "A");
    expect(
      claimGiftSchema.safeParse({ giftId: validUuid, recipientStellarKey: key55 }).success
    ).toBe(false);
  });

  it("rejects a 57-character key (one over)", () => {
    const key57 = "G".padEnd(57, "A");
    expect(
      claimGiftSchema.safeParse({ giftId: validUuid, recipientStellarKey: key57 }).success
    ).toBe(false);
  });

  it("rejects an empty key", () => {
    expect(
      claimGiftSchema.safeParse({ giftId: validUuid, recipientStellarKey: "" }).success
    ).toBe(false);
  });

  it("rejects an invalid UUID for giftId", () => {
    expect(
      claimGiftSchema.safeParse({ giftId: "not-a-uuid", recipientStellarKey: key56 }).success
    ).toBe(false);
  });
});
