/**
 * Moderation service — issue #149
 *
 * Stores message reports in-memory (Map).  A production implementation would
 * persist to the database; the Map is intentionally kept as the single source
 * of truth here so no migration is required.
 */
import { sanitizeMessage } from "@/lib/sanitize";
import type { MessageReport, ModerationAction, ModerationStatus } from "@/types";

// ─── In-memory store ──────────────────────────────────────────────────────────
/** Primary index: reportId → MessageReport */
const reportStore = new Map<string, MessageReport>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateReportId(): string {
  return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deduplication key: one open report per reporter+gift combination. */
function dedupeKey(giftId: string, reporterId: string): string {
  return `${giftId}:${reporterId}`;
}

/**
 * Reports a gift message.
 *
 * Deduplicates by reporter + gift — if the same user has already filed an
 * open (pending) report for this gift, the existing report is returned
 * unchanged.
 *
 * The `reason` string is HTML-escaped via {@link sanitizeMessage} before
 * storage so it is safe to render in any admin UI.
 *
 * @param giftId    - UUID of the gift being reported.
 * @param reporterId - UUID of the authenticated user filing the report.
 * @param reason    - Human-readable description of the issue.
 * @returns The existing or newly-created {@link MessageReport}.
 */
export function reportMessage(giftId: string, reporterId: string, reason: string): MessageReport {
  const key = dedupeKey(giftId, reporterId);

  // Deduplicate: return an existing pending report for the same reporter+gift
  for (const report of reportStore.values()) {
    if (
      report.giftId === giftId &&
      report.reporterId === reporterId &&
      report.status === "pending"
    ) {
      return report;
    }
  }

  const id = generateReportId();
  const report: MessageReport = {
    id,
    giftId,
    reporterId,
    // HTML-escape the reason so it is safe to render in admin UIs
    reason: sanitizeMessage(reason) ?? reason,
    status: "pending" as ModerationStatus,
    createdAt: new Date(),
  };

  reportStore.set(id, report);
  // Store dedup key → reportId for quick lookups (value unused; key is the signal)
  void key; // explicit acknowledgment that we use map iteration for dedup above

  return report;
}

/**
 * Returns all reports sorted by newest-first.
 */
export function getModerationQueue(): MessageReport[] {
  return Array.from(reportStore.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

/**
 * Resolves a report with the given moderation action.
 *
 * @param reportId - ID of the report to resolve.
 * @param action   - `'approved'` (content is fine) or `'removed'` (content taken down).
 * @returns The updated {@link MessageReport}, or `null` if not found.
 */
export function resolveReport(reportId: string, action: ModerationAction): MessageReport | null {
  const report = reportStore.get(reportId);
  if (!report) return null;

  const resolved: MessageReport = {
    ...report,
    status: "resolved" as ModerationStatus,
    action,
    resolvedAt: new Date(),
  };

  reportStore.set(reportId, resolved);
  return resolved;
}
