/**
 * POST /api/v1/gifts/[id]/report
 *
 * Allows an authenticated user to report a gift message for moderation.
 * Deduplicates: if the caller already has a pending report for this gift,
 * the existing report is returned (idempotent).
 *
 * Issue #149 — Gift message moderation & reporting.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { reportMessage } from "@/server/services/moderation.service";
import type { ApiResponse, MessageReport } from "@/types";

export const POST = withErrorHandler(
  withAuth(async (req: NextRequest, context: unknown) => {
    const session = await getServerSession(authOptions);
    // withAuth guarantees session exists — cast is safe
    const reporterId = (session!.user as { id: string }).id;

    const { params } = context as { params: { id: string } };
    const giftId = params.id;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "reason is required", 400);
    }

    const report = reportMessage(giftId, reporterId, body.reason.trim());

    return NextResponse.json<ApiResponse<MessageReport>>(
      { success: true, data: report },
      { status: 201 }
    );
  })
);
