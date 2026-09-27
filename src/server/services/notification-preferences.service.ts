/**
 * Notification Preferences Service
 *
 * Manages per-user opt-in / opt-out settings for notification channels and
 * categories. Security messages are mandatory and can never be disabled.
 * All preference mutations are recorded in the audit log.
 *
 * Issue #71: [backend] Implement notification preferences and consent
 */

import pool from "@/lib/db";
import { createAuditLog } from "./audit.service";

// ─── Domain types ─────────────────────────────────────────────────────────────

/** Supported delivery channels. */
export type NotificationChannel = "sms" | "email" | "push";

/** Notification categories with different opt-out semantics. */
export type NotificationCategory = "security" | "lifecycle" | "marketing";

/**
 * Categories that are always deliverable regardless of user preferences.
 * These carry security-critical information (OTP, suspicious-login alerts, etc.)
 * and MUST NOT be suppressed.
 */
export const MANDATORY_CATEGORIES: ReadonlyArray<NotificationCategory> = ["security"];

/** Preference entry for one channel × category combination. */
export interface NotificationPreferenceEntry {
  channel: NotificationChannel;
  category: NotificationCategory;
  enabled: boolean;
}

/** Full preference set for a single user, keyed by channel then category. */
export interface UserNotificationPreferences {
  userId: string;
  preferences: NotificationPreferenceEntry[];
  updatedAt: Date;
}

/**
 * Partial update payload. Only the entries supplied are changed; the rest are
 * left untouched.
 */
export type NotificationPreferencesUpdate = Omit<NotificationPreferenceEntry, never>[];

// ─── Default preferences factory ─────────────────────────────────────────────

/** All channels × all categories. */
const ALL_CHANNELS: NotificationChannel[] = ["sms", "email", "push"];
const ALL_CATEGORIES: NotificationCategory[] = ["security", "lifecycle", "marketing"];

/**
 * Returns the recommended default preferences for a new user:
 *  - security  : ALL channels ON  (mandatory — cannot opt out)
 *  - lifecycle : ALL channels ON
 *  - marketing : ALL channels OFF
 */
export function buildDefaultPreferences(): NotificationPreferenceEntry[] {
  const defaults: NotificationPreferenceEntry[] = [];
  for (const channel of ALL_CHANNELS) {
    for (const category of ALL_CATEGORIES) {
      defaults.push({
        channel,
        category,
        enabled: category !== "marketing",
      });
    }
  }
  return defaults;
}

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface PreferenceRow {
  channel: NotificationChannel;
  category: NotificationCategory;
  enabled: boolean;
  updated_at: Date;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Fetches the notification preferences for a user.
 *
 * If no rows exist yet (e.g. the user was created before the migration or the
 * seed INSERT did not run), the function transparently upserts the defaults and
 * returns them.
 *
 * @param userId - The user whose preferences to retrieve.
 * @returns The user's full notification preferences.
 */
export async function getPreferences(userId: string): Promise<UserNotificationPreferences> {
  const result = await pool.query<PreferenceRow>(
    `SELECT channel, category, enabled, updated_at
     FROM user_notification_preferences
     WHERE user_id = $1
     ORDER BY category, channel`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Lazily seed defaults for this user — idempotent thanks to ON CONFLICT.
    await seedDefaultPreferences(userId);
    return getPreferences(userId);
  }

  // Use the most recent updated_at across all rows as the overall updated_at.
  const updatedAt = result.rows.reduce<Date>(
    (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
    result.rows[0].updated_at
  );

  return {
    userId,
    preferences: result.rows.map((row) => ({
      channel: row.channel,
      category: row.category,
      enabled: row.enabled,
    })),
    updatedAt,
  };
}

/**
 * Updates notification preferences for a user and writes an audit log entry.
 *
 * Security-category entries are silently ignored — they remain enabled
 * regardless of the values passed in.
 *
 * @param userId  - The user whose preferences are being updated.
 * @param updates - Array of channel × category entries to apply.
 * @param actorId - The user performing the update (typically the same as userId,
 *                  but may differ for admin actions).
 * @returns The updated full preferences.
 */
export async function updatePreferences(
  userId: string,
  updates: NotificationPreferencesUpdate,
  actorId: string
): Promise<UserNotificationPreferences> {
  // Filter out mandatory categories — security notifications cannot be disabled.
  const applicableUpdates = updates.filter(
    (entry) => !(MANDATORY_CATEGORIES as string[]).includes(entry.category)
  );

  if (applicableUpdates.length > 0) {
    // Build a multi-row UPSERT for all applicable changes.
    const valuePlaceholders: string[] = [];
    const params: unknown[] = [userId];
    let idx = 2;

    for (const entry of applicableUpdates) {
      valuePlaceholders.push(`($1, $${idx++}::notification_channel, $${idx++}::notification_category, $${idx++})`);
      params.push(entry.channel, entry.category, entry.enabled);
    }

    await pool.query(
      `INSERT INTO user_notification_preferences (user_id, channel, category, enabled)
       VALUES ${valuePlaceholders.join(", ")}
       ON CONFLICT (user_id, channel, category)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      params
    );
  }

  // Record the mutation in the audit log for compliance.
  await createAuditLog({
    eventType: "notification_preferences_updated",
    userId: actorId,
    metadata: {
      targetUserId: userId,
      updatesRequested: updates.length,
      updatesApplied: applicableUpdates.length,
      skippedMandatory: updates.length - applicableUpdates.length,
      changes: applicableUpdates.map((e) => ({
        channel: e.channel,
        category: e.category,
        enabled: e.enabled,
      })),
    },
  });

  return getPreferences(userId);
}

/**
 * Determines whether a notification should be delivered to the user.
 *
 * Security-category messages are always deliverable, regardless of stored
 * preferences. For all other categories, the stored preference is consulted.
 * If no preference row exists, the default (enabled for lifecycle, disabled
 * for marketing) is used.
 *
 * @param userId   - The target user.
 * @param channel  - The channel on which delivery is planned.
 * @param category - The category of the message.
 * @returns `true` if the message should be sent; `false` otherwise.
 */
export async function isDeliverable(
  userId: string,
  channel: NotificationChannel,
  category: NotificationCategory
): Promise<boolean> {
  // Security messages are always delivered — no DB look-up needed.
  if ((MANDATORY_CATEGORIES as string[]).includes(category)) {
    return true;
  }

  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled
     FROM user_notification_preferences
     WHERE user_id = $1
       AND channel = $2::notification_channel
       AND category = $3::notification_category`,
    [userId, channel, category]
  );

  if (result.rows.length === 0) {
    // Fall back to built-in defaults when no row is stored.
    return category !== "marketing";
  }

  return result.rows[0].enabled;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Inserts the default preference rows for a user.
 * Uses ON CONFLICT DO NOTHING to remain safe when called concurrently.
 */
async function seedDefaultPreferences(userId: string): Promise<void> {
  const defaults = buildDefaultPreferences();

  const valuePlaceholders: string[] = [];
  const params: unknown[] = [userId];
  let idx = 2;

  for (const entry of defaults) {
    valuePlaceholders.push(`($1, $${idx++}::notification_channel, $${idx++}::notification_category, $${idx++})`);
    params.push(entry.channel, entry.category, entry.enabled);
  }

  await pool.query(
    `INSERT INTO user_notification_preferences (user_id, channel, category, enabled)
     VALUES ${valuePlaceholders.join(", ")}
     ON CONFLICT (user_id, channel, category) DO NOTHING`,
    params
  );
}
