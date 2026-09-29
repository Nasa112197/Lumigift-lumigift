import { NextRequest, NextResponse } from "next/server";
import { indexEscrowEvents } from "@/server/services/event-indexer.service";
import type { ApiResponse } from "@/types";

/**
 * GET /api/v1/cron/index-events
 *
 * Cron endpoint — indexes Soroban escrow contract events and syncs gift status.
 *
 * Called by Vercel Cron every 5 minutes (see vercel.json).
 * Protected by the same CRON_SECRET bearer token used by other cron routes.
 *
 * Dead-man's-switch: pings HEALTHCHECK_URL_INDEX_EVENTS (or HEALTHCHECK_URL) on
 * success so operators are alerted when the cron stops firing.
 */

/** Ping a dead-man's-switch URL (e.g. Healthchecks.io / BetterUptime). */
async function pingHealthcheck(suffix = "") {
  const url = process.env.HEALTHCHECK_URL_INDEX_EVENTS ?? process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(`${url}${suffix}`, { method: "GET" });
  } catch (err) {
    console.error("[cron/index-events] healthcheck ping failed", err);
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
  console.log("[cron/index-events] run started", {
    startedAt: new Date(startedAt).toISOString(),
  });

  try {
    const result = await indexEscrowEvents();
    const durationMs = Date.now() - startedAt;

    console.log("[cron/index-events] run complete", { ...result, durationMs });

    await pingHealthcheck(); // success ping

    return NextResponse.json<
      ApiResponse<{ processed: number; skipped: number; latestCursor: string; durationMs: number }>
    >({
      success: true,
      data: { ...result, durationMs },
    });
  } catch (err) {
    console.error("[cron/index-events] run failed", err);
    await pingHealthcheck("/fail"); // failure ping
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Event indexing failed" },
      { status: 500 }
    );
  }
};
