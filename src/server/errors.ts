/**
 * Standardized application error types and error-code mapping (Issue #63).
 *
 * Public error codes are stable strings that clients can program against.
 * Internal causes (stack traces, provider details, DB messages) are never
 * serialised to responses — they are logged server-side with the correlation ID.
 *
 * Usage:
 *   throw new AppError("GIFT_NOT_FOUND", "Gift not found", 404);
 *   throw new AppError("PAYMENT_FAILED", "Payment failed", 402, originalErr);
 */

// ─── Public error code registry ───────────────────────────────────────────────

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  // Input
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",

  // Gift domain
  GIFT_NOT_FOUND: "GIFT_NOT_FOUND",
  GIFT_ALREADY_CLAIMED: "GIFT_ALREADY_CLAIMED",
  GIFT_NOT_UNLOCKED: "GIFT_NOT_UNLOCKED",
  GIFT_INVALID_STATE: "GIFT_INVALID_STATE",
  GIFT_DAILY_LIMIT: "GIFT_DAILY_LIMIT",

  // Payment domain
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_INVALID_SIGNATURE: "PAYMENT_INVALID_SIGNATURE",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  RATE_SLIPPAGE: "RATE_SLIPPAGE",
  RATE_EXPIRED: "RATE_EXPIRED",

  // Infrastructure
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─── Application error class ──────────────────────────────────────────────────

/**
 * Structured error that carries a stable public error code, an HTTP status,
 * and optionally the original cause for server-side logging.
 *
 * The `cause` is intentionally NOT serialised into API responses.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus: number = 400, cause?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.cause = cause;
  }

  /** Serialise to a safe public response body — no internal details. */
  toResponse() {
    return {
      success: false as const,
      error: this.message,
      code: this.code,
    };
  }
}

// ─── Error-to-code mapping ────────────────────────────────────────────────────

/**
 * Maps well-known error messages from services to stable public codes.
 * If no mapping is found, the original error is treated as INTERNAL_ERROR.
 */
const MESSAGE_TO_CODE: Array<{ match: RegExp; code: ErrorCode; status: number }> = [
  { match: /not yet unlocked/i, code: "GIFT_NOT_UNLOCKED", status: 409 },
  { match: /already claimed/i, code: "GIFT_ALREADY_CLAIMED", status: 409 },
  { match: /invalid.*transition/i, code: "GIFT_INVALID_STATE", status: 409 },
  { match: /daily sending limit/i, code: "GIFT_DAILY_LIMIT", status: 429 },
  { match: /gift not found/i, code: "GIFT_NOT_FOUND", status: 404 },
  { match: /rate.*expired/i, code: "RATE_EXPIRED", status: 409 },
  { match: /rate.*slippage/i, code: "RATE_SLIPPAGE", status: 409 },
  { match: /rate.?limit/i, code: "RATE_LIMIT_EXCEEDED", status: 429 },
  { match: /unauthorized/i, code: "UNAUTHORIZED", status: 401 },
  { match: /forbidden/i, code: "FORBIDDEN", status: 403 },
];

export interface MappedError {
  code: ErrorCode;
  status: number;
  /** Safe public message — never contains internal details. */
  publicMessage: string;
}

/**
 * Maps any thrown error to a stable public code and HTTP status.
 * If the error is already an AppError, its values are returned as-is.
 * Otherwise a generic INTERNAL_ERROR is used so no provider secrets leak.
 */
export function mapError(err: unknown): MappedError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      status: err.httpStatus,
      publicMessage: err.message,
    };
  }

  if (err instanceof Error) {
    for (const { match, code, status } of MESSAGE_TO_CODE) {
      if (match.test(err.message)) {
        return { code, status, publicMessage: err.message };
      }
    }
  }

  // Unknown / unexpected error — never surface internal details
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    publicMessage: "An unexpected error occurred. Please try again.",
  };
}
