import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions } from "@/lib/auth";
import { ApiError } from "@/types";
import { requestLogger, getCorrelationId } from "@/lib/logger";
import { mapError, AppError } from "@/server/errors";

// Re-export error primitives so route handlers can import from one place
export { AppError } from "@/server/errors";
export { ERROR_CODES } from "@/server/errors";

// Re-export CSRF middleware so callers can import from one place
export { withCsrf } from "@/lib/csrf";

type Handler = (_req: NextRequest, _context?: unknown) => Promise<NextResponse>;

/** Wraps a route handler — returns 401 if no session. */
export function withAuth(handler: Handler): Handler {
  return async (req, _context) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    return handler(req, _context);
  };
}

const API_VERSION = "v1";

/**
 * Wraps a route handler with error handling that:
 *  1. Extracts / generates a correlation ID from the `x-correlation-id` header.
 *  2. Maps thrown errors to stable public codes via {@link mapError}.
 *  3. Logs the full internal error (including stack trace) to Pino + Sentry,
 *     tagged with the correlation ID so every log line is traceable.
 *  4. Returns a sanitised response body — no stack traces or provider secrets
 *     ever reach the client.
 *  5. Attaches `x-correlation-id` and `X-API-Version` to every response.
 */
export function withErrorHandler(handler: Handler): Handler {
  return async (req, context) => {
    const correlationId = getCorrelationId(req.headers);
    const log = requestLogger(correlationId);
    try {
      const res = await handler(req, context);
      res.headers.set("X-API-Version", API_VERSION);
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (err) {
      const mapped = mapError(err);

      // Log full internal error server-side — stack + cause never leave the server
      if (mapped.code === "INTERNAL_ERROR") {
        log.error({ err, correlationId, path: req.nextUrl.pathname }, "[API] Unhandled error");
        // Report unexpected errors to Sentry with correlation ID for tracing
        Sentry.withScope((scope) => {
          scope.setTag("correlationId", correlationId);
          scope.setTag("path", req.nextUrl.pathname);
          scope.setExtra("url", req.url);
          Sentry.captureException(err);
        });
      } else {
        // Known/expected error — log at warn level with correlation ID
        log.warn(
          { code: mapped.code, status: mapped.status, correlationId, err },
          "[API] Application error"
        );
      }

      const res = NextResponse.json<ApiError>(
        {
          success: false,
          error: mapped.publicMessage,
          code: mapped.code,
          // correlationId in the body makes it easy for clients to report issues
          ...(correlationId ? { correlationId } : {}),
        } as ApiError & { correlationId?: string },
        { status: mapped.status }
      );
      res.headers.set("X-API-Version", API_VERSION);
      res.headers.set("x-correlation-id", correlationId);
      return res;
    }
  };
}

/** Rate-limit helper (simple in-memory; swap for Redis in production). */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}
