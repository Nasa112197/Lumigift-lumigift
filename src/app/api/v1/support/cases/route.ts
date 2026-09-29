/**
 * POST /api/v1/support/cases  — Create (or return existing) support case
 * GET  /api/v1/support/cases  — List the authenticated user's own cases
 *
 * Support escalation for failed money movement.
 * Issue #152 — Support escalation for failed money movement.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { createSupportCase, listSupportCases } from "@/server/services/support.service";
import type { ApiResponse, SupportCase } from "@/types";

/**
 * POST /api/v1/support/cases
 *
 * Body: `{ giftId: string, reason: string, details?: string }`
 *
 * Idempotent — returns the existing open case if one already exists for the
 * same user + gift combination.
 */
export const POST = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const body = await req.json().catch(() => null);

    if (!body || typeof body.giftId !== "string" || !body.giftId.trim()) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "giftId is required", 400);
    }
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "reason is required", 400);
    }

    const details: string | undefined =
      typeof body.details === "string" ? body.details.trim() || undefined : undefined;

    const supportCase = createSupportCase(userId, body.giftId.trim(), body.reason.trim(), details);

    return NextResponse.json<ApiResponse<SupportCase>>(
      { success: true, data: supportCase },
      { status: 201 }
    );
  })
);

/**
 * GET /api/v1/support/cases
 *
 * Returns all support cases belonging to the authenticated user, sorted
 * newest-first.
 */
export const GET = withErrorHandler(
  withAuth(async (_req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const cases = listSupportCases(userId);

    return NextResponse.json<ApiResponse<SupportCase[]>>({ success: true, data: cases });
  })
);
