/**
 * Centralized request-body validation helpers (Issue #62).
 *
 * Provides a single `validateBody` function that:
 *  - Handles malformed / non-JSON bodies gracefully (400, INVALID_PAYLOAD).
 *  - Strips unknown top-level fields via Zod's `.strict()` or the caller's schema config.
 *  - Returns sanitized, field-level validation errors that never echo raw input
 *    (prevents sensitive values leaking in error responses).
 *  - Uses the same {@link AppError} / {@link ERROR_CODES} convention used everywhere.
 *
 * Usage in a route handler:
 * ```ts
 * const result = await validateBody(req, createGiftSchema);
 * if (!result.success) return result.response;
 * const data = result.data; // fully typed
 * ```
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodSchema, ZodError } from "zod";
import type { ApiError } from "@/types";
import { ERROR_CODES } from "@/server/errors";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ValidationSuccess<T> = {
  success: true;
  data: T;
};

export type ValidationFailure = {
  success: false;
  /** Ready-to-return NextResponse — just `return result.response` in your handler. */
  response: NextResponse<ApiError>;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ─── Field-level error formatting ────────────────────────────────────────────

/**
 * Converts a ZodError into a flat list of field → message pairs.
 * Input *values* are deliberately excluded — only field paths and messages
 * are returned so that sensitive data (phone numbers, amounts, etc.) is never
 * echoed back to the client.
 */
function formatZodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "_root";
    // Only keep the first message per field to keep responses compact
    if (!out[field]) {
      out[field] = issue.message;
    }
  }
  return out;
}

// ─── Core validation helper ───────────────────────────────────────────────────

/**
 * Parses and validates the JSON body of a {@link NextRequest} against the
 * provided Zod schema.
 *
 * Handles three categories of error:
 *  1. **Non-JSON / malformed body** → `INVALID_PAYLOAD` (400)
 *  2. **Schema validation failure** → `VALIDATION_ERROR` (400) with field errors
 *  3. **Unexpected parse error**    → `INVALID_PAYLOAD` (400)
 *
 * On success, returns `{ success: true, data }` where `data` is the fully
 * typed, Zod-transformed output (safe to use directly in service calls).
 *
 * @param req    The incoming Next.js request.
 * @param schema A Zod schema to validate against.
 * @returns A discriminated {@link ValidationResult}.
 */
export async function validateBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
  additionalFields: Record<string, unknown> = {}
): Promise<ValidationResult<T>> {
  // ── 1. Parse JSON ──────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json<ApiError>(
        {
          success: false,
          error: "Request body must be valid JSON.",
          code: ERROR_CODES.INVALID_PAYLOAD,
        },
        { status: 400 }
      ),
    };
  }

  // Reject non-object bodies (arrays, primitives) — all our endpoints expect objects
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      success: false,
      response: NextResponse.json<ApiError>(
        {
          success: false,
          error: "Request body must be a JSON object.",
          code: ERROR_CODES.INVALID_PAYLOAD,
        },
        { status: 400 }
      ),
    };
  }

  // ── 2. Validate against schema ────────────────────────────────────────────
  const parsed = schema.safeParse({ ...raw, ...additionalFields });

  if (!parsed.success) {
    const fieldErrors = formatZodErrors(parsed.error);
    // Use the first field error as the top-level message for API consumers
    const firstMessage = Object.values(fieldErrors)[0] ?? "Validation failed.";

    return {
      success: false,
      response: NextResponse.json<ApiError & { fieldErrors?: Record<string, string> }>(
        {
          success: false,
          error: firstMessage,
          code: ERROR_CODES.VALIDATION_ERROR,
          fieldErrors,
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: parsed.data };
}
