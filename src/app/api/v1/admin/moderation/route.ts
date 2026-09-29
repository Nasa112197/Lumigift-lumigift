/**
 * GET  /api/v1/admin/moderation
 * POST /api/v1/admin/moderation  — resolve a report
 *
 * Admin-only endpoints for the gift message moderation queue.
 * Issue #149 — Gift message moderation & reporting.
 */
import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { requireAdmin } from "@/server/middleware/admin";
import { getModerationQueue, resolveReport } from "@/server/services/moderation.service";
import type { ApiResponse, MessageReport, ModerationAction } from "@/types";

/** Returns all pending and resolved reports sorted newest-first (admin only). */
export const GET = withErrorHandler(async (_req: NextRequest) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const queue = getModerationQueue();
  return NextResponse.json<ApiResponse<MessageReport[]>>({ success: true, data: queue });
});

/**
 * Resolves a specific report.
 * Body: `{ reportId: string, action: 'approved' | 'removed' }`
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);

  if (!body || typeof body.reportId !== "string" || !body.reportId.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "reportId is required", 400);
  }

  const validActions: ModerationAction[] = ["approved", "removed"];
  if (!validActions.includes(body.action)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_ERROR,
      `action must be one of: ${validActions.join(", ")}`,
      400
    );
  }

  const resolved = resolveReport(body.reportId, body.action as ModerationAction);
  if (!resolved) {
    throw new AppError(ERROR_CODES.GIFT_NOT_FOUND, "Report not found", 404);
  }

  return NextResponse.json<ApiResponse<MessageReport>>({ success: true, data: resolved });
});
