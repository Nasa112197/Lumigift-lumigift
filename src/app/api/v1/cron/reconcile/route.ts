/**
 * POST /api/v1/cron/reconcile
 *
 * Called by Vercel Cron (or an external scheduler) every 15 minutes to poll
 * Paystack for gifts whose webhooks were missed.
 *
 * Security: protected by CRON_SECRET bearer token (same pattern as other cron routes).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  reconcilePendingPayments,
  getDeadLetteredGiftIds,
} from "@/server/services/payment-reconciliation.service";
import type { ApiResponse } from "@/types";
import type { ReconcileResult } from "@/server/services/payment-reconciliation.service";

export const GET = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = Date.now();

  const result = await reconcilePendingPayments();
  const deadLettered = await getDeadLetteredGiftIds();

  const durationMs = Date.now() - startedAt;

  return NextResponse.json<
    ApiResponse<ReconcileResult & { durationMs: number; deadLetteredTotal: number }>
  >({
    success: true,
    data: {
      ...result,
      durationMs,
      deadLetteredTotal: deadLettered.length,
    },
  });
};
