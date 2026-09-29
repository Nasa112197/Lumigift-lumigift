import { NextRequest, NextResponse } from "next/server";
import { processExpiries } from "@/server/services/scheduler.service";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/cron/expire
 *
 * Called daily at 02:00 UTC by Vercel Cron (see vercel.json).
 * Expires unlocked gifts that have been unclaimed for more than 365 days,
 * triggers a refund to the sender, and sends an SMS notification.
 *
 * Dead-man's-switch: pings HEALTHCHECK_URL_EXPIRE (or HEALTHCHECK_URL) on
 * success so operators are alerted if the daily cron stops firing.
 */

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL_EXPIRE ?? process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    console.error("[cron/expire] healthcheck ping failed", err);
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

  const startedAt = new Date();
  console.log("[cron/expire] run started", { startedAt });

  try {
    await processExpiries();
    const durationMs = Date.now() - startedAt.getTime();

    console.log("[cron/expire] run complete", { durationMs });

    await pingHealthcheck(); // success ping

    return NextResponse.json<ApiResponse<{ message: string; durationMs: number }>>({
      success: true,
      data: { message: "Expiry check complete", durationMs },
    });
  } catch (err) {
    console.error("[cron/expire] run failed", { startedAt, error: err });
    await pingHealthcheck("/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Expiry job failed" },
      { status: 500 }
    );
  }
};
