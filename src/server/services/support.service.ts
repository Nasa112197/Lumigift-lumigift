/**
 * Support escalation service — issue #152
 *
 * Handles support cases for failed money movement.  Cases are stored in-memory
 * (Map).  A production implementation would persist to the database; the Map
 * is the intentional source of truth here so no migration is required.
 */
import type { SupportCase, SupportCaseStatus } from "@/types";

// ─── In-memory store ──────────────────────────────────────────────────────────
/** Primary index: caseReference → SupportCase */
const caseStore = new Map<string, SupportCase>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a unique case reference in the format `SUP-YYYYMMDD-XXXX`
 * where XXXX is a random 4-char uppercase hex string.
 */
function generateCaseReference(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `SUP-${yyyy}${mm}${dd}-${hex}`;
}

function generateCaseId(): string {
  return `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Creates a support case for a failed money movement.
 *
 * Idempotent: if an **open** case already exists for the same user + gift
 * combination, the existing case is returned without creating a duplicate.
 *
 * @param userId  - UUID of the authenticated user filing the case.
 * @param giftId  - UUID of the gift that experienced the issue.
 * @param reason  - Short description of the problem.
 * @param details - Optional extended details.
 * @returns The existing or newly-created {@link SupportCase}.
 */
export function createSupportCase(
  userId: string,
  giftId: string,
  reason: string,
  details?: string
): SupportCase {
  // Deduplication: return any existing open case for the same user+gift
  for (const existing of caseStore.values()) {
    if (existing.userId === userId && existing.giftId === giftId && existing.status === "open") {
      return existing;
    }
  }

  const now = new Date();
  const supportCase: SupportCase = {
    id: generateCaseId(),
    caseReference: generateCaseReference(),
    userId,
    giftId,
    reason,
    details,
    status: "open" as SupportCaseStatus,
    createdAt: now,
    updatedAt: now,
  };

  caseStore.set(supportCase.caseReference, supportCase);
  return supportCase;
}

/**
 * Retrieves a support case by its reference string.
 *
 * @param caseReference - Reference in the format `SUP-YYYYMMDD-XXXX`.
 * @returns The {@link SupportCase}, or `null` if not found.
 */
export function getSupportCase(caseReference: string): SupportCase | null {
  return caseStore.get(caseReference) ?? null;
}

/**
 * Lists all support cases, optionally filtered by userId.
 *
 * @param userId - When provided, only cases belonging to this user are returned.
 * @returns Array of {@link SupportCase} sorted newest-first.
 */
export function listSupportCases(userId?: string): SupportCase[] {
  const all = Array.from(caseStore.values());
  const filtered = userId ? all.filter((c) => c.userId === userId) : all;
  return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
