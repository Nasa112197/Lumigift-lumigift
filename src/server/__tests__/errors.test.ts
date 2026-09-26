/**
 * @jest-environment node
 *
 * Unit tests for src/server/errors.ts (Issue #63).
 *
 * Verifies:
 *  - AppError carries stable code, HTTP status, and optional cause
 *  - mapError returns the correct code/status for known error messages
 *  - mapError returns INTERNAL_ERROR (500) and a safe message for unknown errors
 *  - Stack traces and provider secrets never appear in public responses
 *  - AppError.toResponse() never includes the cause
 */

import { AppError, ERROR_CODES, mapError, type ErrorCode } from "@/server/errors";

// ─── AppError ─────────────────────────────────────────────────────────────────

describe("AppError", () => {
  it("stores code, message, and httpStatus", () => {
    const err = new AppError("GIFT_NOT_FOUND", "Gift not found", 404);
    expect(err.code).toBe("GIFT_NOT_FOUND");
    expect(err.message).toBe("Gift not found");
    expect(err.httpStatus).toBe(404);
  });

  it("stores optional cause but does not include it in toResponse()", () => {
    const cause = new Error("DB connection failed");
    const err = new AppError("INTERNAL_ERROR", "Something went wrong", 500, cause);
    expect(err.cause).toBe(cause);
    const response = err.toResponse();
    expect(response).not.toHaveProperty("cause");
    expect(response).not.toHaveProperty("stack");
    expect(JSON.stringify(response)).not.toContain("DB connection failed");
  });

  it("toResponse() returns a safe public shape", () => {
    const err = new AppError("VALIDATION_ERROR", "Invalid input", 400);
    expect(err.toResponse()).toEqual({
      success: false,
      error: "Invalid input",
      code: "VALIDATION_ERROR",
    });
  });

  it("has name AppError", () => {
    expect(new AppError("UNAUTHORIZED", "Unauthorized").name).toBe("AppError");
  });

  it("defaults httpStatus to 400", () => {
    const err = new AppError("VALIDATION_ERROR", "Bad input");
    expect(err.httpStatus).toBe(400);
  });
});

// ─── mapError — AppError passthrough ─────────────────────────────────────────

describe("mapError with AppError", () => {
  it("returns the AppError code, status, and message unchanged", () => {
    const err = new AppError("GIFT_NOT_FOUND", "Gift not found", 404);
    const mapped = mapError(err);
    expect(mapped).toEqual({
      code: "GIFT_NOT_FOUND",
      status: 404,
      publicMessage: "Gift not found",
    });
  });
});

// ─── mapError — known Error messages ─────────────────────────────────────────

describe("mapError with known Error messages", () => {
  const cases: Array<{ message: string; expectedCode: ErrorCode; expectedStatus: number }> = [
    {
      message: "Gift is not yet unlocked.",
      expectedCode: "GIFT_NOT_UNLOCKED",
      expectedStatus: 409,
    },
    { message: "Already claimed", expectedCode: "GIFT_ALREADY_CLAIMED", expectedStatus: 409 },
    {
      message: "Invalid state transition",
      expectedCode: "GIFT_INVALID_STATE",
      expectedStatus: 409,
    },
    {
      message: "Daily sending limit of ₦500,000 exceeded",
      expectedCode: "GIFT_DAILY_LIMIT",
      expectedStatus: 429,
    },
    { message: "Gift not found", expectedCode: "GIFT_NOT_FOUND", expectedStatus: 404 },
    { message: "Rate expired", expectedCode: "RATE_EXPIRED", expectedStatus: 409 },
    { message: "Rate slippage exceeded", expectedCode: "RATE_SLIPPAGE", expectedStatus: 409 },
    { message: "Rate limit exceeded", expectedCode: "RATE_LIMIT_EXCEEDED", expectedStatus: 429 },
    { message: "Unauthorized", expectedCode: "UNAUTHORIZED", expectedStatus: 401 },
    { message: "Forbidden", expectedCode: "FORBIDDEN", expectedStatus: 403 },
  ];

  test.each(cases)(
    "$message → $expectedCode ($expectedStatus)",
    ({ message, expectedCode, expectedStatus }) => {
      const mapped = mapError(new Error(message));
      expect(mapped.code).toBe(expectedCode);
      expect(mapped.status).toBe(expectedStatus);
    }
  );
});

// ─── mapError — unknown / internal errors ─────────────────────────────────────

describe("mapError with unknown errors", () => {
  it("maps an unknown Error to INTERNAL_ERROR with a safe message", () => {
    const err = new Error("Paystack API key: sk_live_supersecret123");
    const mapped = mapError(err);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.status).toBe(500);
    // Public message must NOT contain the original internal error message
    expect(mapped.publicMessage).not.toContain("Paystack API key");
    expect(mapped.publicMessage).not.toContain("sk_live_supersecret123");
  });

  it("maps a non-Error thrown value to INTERNAL_ERROR", () => {
    const mapped = mapError("some string error");
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.status).toBe(500);
  });

  it("maps null to INTERNAL_ERROR", () => {
    expect(mapError(null).code).toBe("INTERNAL_ERROR");
  });

  it("maps undefined to INTERNAL_ERROR", () => {
    expect(mapError(undefined).code).toBe("INTERNAL_ERROR");
  });

  it("public message for INTERNAL_ERROR does not expose stack traces", () => {
    const err = new Error("SELECT * FROM users WHERE id = 1; DROP TABLE users;");
    const mapped = mapError(err);
    expect(mapped.publicMessage).not.toContain("SELECT");
    expect(mapped.publicMessage).not.toContain("DROP TABLE");
  });
});

// ─── ERROR_CODES completeness ─────────────────────────────────────────────────

describe("ERROR_CODES", () => {
  it("includes all expected codes", () => {
    expect(ERROR_CODES.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(ERROR_CODES.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    expect(ERROR_CODES.GIFT_NOT_FOUND).toBe("GIFT_NOT_FOUND");
    expect(ERROR_CODES.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ERROR_CODES.IDEMPOTENCY_CONFLICT).toBe("IDEMPOTENCY_CONFLICT");
  });
});
