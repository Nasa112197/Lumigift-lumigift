import { AuditEventType, type AuditLogQuery } from "@/server/services/audit.service";

const MAX_LIMIT = 100;
const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "gift_created",
  "payment_received",
  "gift_funded",
  "gift_claimed",
  "gift_cancelled",
  "payment_failed",
  "gift_refunded",
];

function parseIntegerParam(value: string | null, defaultValue: number): number | null {
  if (value === null) return defaultValue;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

export function parseAuditLogQuery(
  searchParams: URLSearchParams
): { query: AuditLogQuery } | { error: string } {
  const eventType = searchParams.get("eventType");
  if (eventType !== null && !AUDIT_EVENT_TYPES.includes(eventType as AuditEventType)) {
    return { error: "Invalid eventType" };
  }

  const limit = parseIntegerParam(searchParams.get("limit"), 50);
  if (limit === null || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be between 1 and ${MAX_LIMIT}` };
  }

  const offset = parseIntegerParam(searchParams.get("offset"), 0);
  if (offset === null) {
    return { error: "offset must be a non-negative integer" };
  }

  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");
  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;

  if (startDateStr && Number.isNaN(startDate?.getTime())) {
    return { error: "Invalid startDate format" };
  }
  if (endDateStr && Number.isNaN(endDate?.getTime())) {
    return { error: "Invalid endDate format" };
  }
  if (startDate && endDate && startDate > endDate) {
    return { error: "startDate must be before or equal to endDate" };
  }

  return {
    query: {
      userId: searchParams.get("userId") ?? undefined,
      giftId: searchParams.get("giftId") ?? undefined,
      eventType: (eventType as AuditEventType | null) ?? undefined,
      startDate,
      endDate,
      limit,
      offset,
    },
  };
}
