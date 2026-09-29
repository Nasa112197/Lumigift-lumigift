/**
 * GET /api/v1/cron/reconcile
 *
 * Called by Vercel Cron every 6 hours to poll Paystack for gifts whose
 * webhooks were missed, and to surface dead-lettered gifts.
 *
 * Security: protected by CRON_SECRET bearer token (same pattern as other cron routes).
 *
 * Dead-man's-switch: pings HEALTHCHECK_URL_RECONCILE (or HEALTHCHECK_URL) on
 * success so operators are alerted when the cron stops firing.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  reconcilePendingPayments,
  getDeadLetteredGiftIds,
} from "@/server/services/payment-reconciliation.service";
import type { ApiResponse } from "@/types";
import type { ReconcileResult } from "@/server/services/payment-reconciliation.service";

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL_RECONCILE ?? process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    console.error("[cron/reconcile] healthcheck ping failed", err);
  }
}

export const GET = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startedAt = Date.now();
  console.log("[cron/reconcile] run started", { startedAt: new Date(startedAt).toISOString() });

  try {
    const result = await reconcilePendingPayments();
    const deadLettered = await getDeadLetteredGiftIds();
    const durationMs = Date.now() - startedAt;

    console.log("[cron/reconcile] run complete", {
      ...result,
      durationMs,
      deadLetteredTotal: deadLettered.length,
    });

    await pingHealthcheck(); // success ping

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
  } catch (err) {
    console.error("[cron/reconcile] run failed", err);
    await pingHealthcheck("/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Reconciliation job failed" },
      { status: 500 }
    );
  }
};
