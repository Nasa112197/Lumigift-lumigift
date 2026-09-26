/**
 * Timezone-aware date formatting utilities for Lumigift.
 *
 * All timestamps are stored in UTC. This module formats them deterministically
 * in the user's local timezone and shows the abbreviated timezone name so
 * the sender and recipient always see consistent, unambiguous unlock times.
 */

/**
 * Returns a human-readable, timezone-annotated string for a UTC timestamp.
 *
 * Example: "Jan 1, 2025 at 9:00 AM (WAT)"
 *
 * Uses `Intl.DateTimeFormat` which is deterministic: for any given timestamp
 * and timezone, the output is always the same string. This avoids the
 * ambiguity of `date-fns/format` which relies on `Date` construction and
 * can behave differently during DST transitions.
 *
 * @param utcTimestamp - A Date object, ISO string, or epoch ms in UTC.
 * @param timeZone - IANA timezone identifier (defaults to the user's local TZ).
 */
export function formatUnlockDate(utcTimestamp: Date | string | number, timeZone?: string): string {
  const date = utcTimestamp instanceof Date ? utcTimestamp : new Date(utcTimestamp);

  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  const tzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? tz;

  return `${datePart} at ${timePart} (${tzAbbr})`;
}

/**
 * Converts a `datetime-local` input value (which has no timezone offset) to
 * a full ISO-8601 UTC string by treating it as a time in the user's local
 * timezone.
 *
 * `<input type="datetime-local">` always returns values like "2025-01-01T09:00"
 * with no offset. Without this conversion the value is ambiguous — JavaScript
 * parses bare date-time strings as *local* time in some environments and UTC
 * in others. We make it explicit.
 *
 * @param localDateTimeValue - The raw string from a datetime-local input.
 * @returns An ISO-8601 UTC string, e.g. "2025-01-01T08:00:00.000Z"
 */
export function localDateTimeToUtcIso(localDateTimeValue: string): string {
  if (!localDateTimeValue) return "";
  // Appending the user's UTC offset turns the local string into an unambiguous
  // zoned instant, then converting to UTC via toISOString() is exact.
  const offsetMs = new Date().getTimezoneOffset() * 60_000; // minutes → ms
  const localMs = new Date(localDateTimeValue).getTime();
  return new Date(localMs + offsetMs).toISOString();
}

/**
 * Returns whether a datetime-local input value falls within a DST
 * "spring-forward" gap (i.e. a time that does not exist in the local
 * timezone). Returns true if the time is ambiguous/invalid.
 *
 * Used to surface a warning in the gift-creation form so senders don't pick
 * a time that will silently shift.
 *
 * @param localDateTimeValue - Raw datetime-local input value.
 */
export function isAmbiguousDstTransition(localDateTimeValue: string): boolean {
  if (!localDateTimeValue) return false;
  const parsed = new Date(localDateTimeValue);
  if (isNaN(parsed.getTime())) return false;

  // Re-format the parsed date back to local time. If the hour differs from
  // what the user typed, the time fell in a gap.
  const [, timePart] = localDateTimeValue.split("T");
  const [hours] = timePart.split(":");
  const localHour = parsed.getHours();
  return localHour !== Number(hours);
}
