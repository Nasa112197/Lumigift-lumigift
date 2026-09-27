/**
 * Notification Delivery Abstraction (Issue #70)
 *
 * Provides a unified dispatcher for SMS and email notifications with:
 *  - Idempotency via Redis deduplication keys (same key → same result)
 *  - Bounded retries (max 3 attempts) with exponential backoff (100ms × 2^attempt)
 *  - Provider errors are caught and returned as a failed DeliveryResult — never thrown
 *  - Gift state is never mutated by the notification layer
 *
 * Provider adapters (sms.ts, email.ts) remain unchanged and are wrapped here.
 *
 * Key format: `notification:dedup:{dedupKey}`
 * TTL: 24 hours
 */

import { getRedisClient } from "@/lib/redis";
import { serviceLogger } from "@/lib/logger";

// ─── SMS adapter imports ──────────────────────────────────────────────────────
import {
  sendOtp,
  sendNewDeviceAlert,
  sendGiftInvitation,
} from "@/lib/sms";

// ─── Email adapter imports ────────────────────────────────────────────────────
import {
  sendGiftReceivedEmail,
  sendUnlockReminderEmail,
  sendClaimConfirmationEmail,
  type GiftEmailData,
} from "@/lib/email";

const log = serviceLogger("notification");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of delivery attempts per notification. */
export const MAX_ATTEMPTS = 3;

/** Base delay in milliseconds for exponential backoff. Delay = BASE_BACKOFF_MS × 2^attempt */
export const BASE_BACKOFF_MS = 100;

/** Redis key TTL — cached results expire after 24 hours. */
export const DEDUP_TTL_SECONDS = 86_400;

/** Redis key prefix for notification deduplication. */
const DEDUP_KEY_PREFIX = "notification:dedup:";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported notification delivery channels. */
export enum NotificationChannel {
  Sms = "sms",
  Email = "email",
}

// SMS payload variants
export type SmsOtpPayload = {
  type: "otp";
  phone: string;
};

export type SmsNewDeviceAlertPayload = {
  type: "new_device_alert";
  phone: string;
  time: string;
  country: string;
  reportUrl: string;
};

export type SmsGiftInvitationPayload = {
  type: "gift_invitation";
  phone: string;
  invitationToken: string;
  senderName: string;
};

export type SmsPayload =
  | SmsOtpPayload
  | SmsNewDeviceAlertPayload
  | SmsGiftInvitationPayload;

// Email payload variants
export type EmailGiftReceivedPayload = {
  type: "gift_received";
  to: string;
  data: GiftEmailData;
};

export type EmailUnlockReminderPayload = {
  type: "unlock_reminder";
  to: string;
  data: GiftEmailData;
};

export type EmailClaimConfirmationPayload = {
  type: "claim_confirmation";
  to: string;
  data: GiftEmailData;
};

export type EmailPayload =
  | EmailGiftReceivedPayload
  | EmailUnlockReminderPayload
  | EmailClaimConfirmationPayload;

/**
 * Union of all notification payloads.
 * The `channel` in `sendNotification` determines which sub-type is expected.
 */
export type NotificationPayload = SmsPayload | EmailPayload;

/** Delivery outcome for a single notification dispatch. */
export type DeliveryStatus = "sent" | "failed" | "skipped";

export interface DeliveryResult {
  /** Final delivery outcome. */
  status: DeliveryStatus;
  /** Provider name (e.g. "termii" or "resend"). */
  provider: string;
  /** Number of attempts made, including the final one. */
  attempts: number;
  /** Error message if status is "failed". Undefined on success or skip. */
  error?: string;
  /** The generated OTP code, only present for SMS OTP notifications. */
  otp?: string;
}

/** Options for `sendNotification`. */
export interface SendNotificationOptions {
  /**
   * Deduplication key. If provided, Redis is checked before sending.
   * A repeated call with the same key returns the cached result without
   * re-dispatching to the provider.
   *
   * Must be a non-empty string (e.g. `"otp:${userId}:${Date.now()}"`).
   * Omit the key to bypass idempotency (e.g. for fire-and-forget alerts).
   */
  dedupKey?: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

/** Shape stored in Redis for a completed delivery. */
interface CachedDeliveryResult extends DeliveryResult {
  cachedAt: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds the Redis key for a deduplication entry. */
function buildDedupRedisKey(dedupKey: string): string {
  return `${DEDUP_KEY_PREFIX}${dedupKey}`;
}

/** Returns a promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Computes exponential backoff delay for a given attempt index (0-based). */
export function backoffDelayMs(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

// ─── Provider dispatch ────────────────────────────────────────────────────────

/**
 * Dispatches a single SMS notification via the Termii adapter.
 * Returns the OTP string when `payload.type === "otp"`, otherwise `undefined`.
 *
 * @throws Any error from the underlying SMS provider (caller handles retries).
 */
async function dispatchSms(payload: SmsPayload): Promise<string | undefined> {
  switch (payload.type) {
    case "otp": {
      const otp = await sendOtp(payload.phone);
      return otp;
    }
    case "new_device_alert": {
      await sendNewDeviceAlert(payload.phone, {
        time: payload.time,
        country: payload.country,
        reportUrl: payload.reportUrl,
      });
      return undefined;
    }
    case "gift_invitation": {
      await sendGiftInvitation(payload.phone, payload.invitationToken, payload.senderName);
      return undefined;
    }
    default: {
      // Exhaustive check — TypeScript will catch unhandled variants at compile time
      const _exhaustive: never = payload;
      throw new Error(`Unknown SMS payload type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Dispatches a single email notification via the Resend adapter.
 *
 * @throws Any error from the underlying email provider (caller handles retries).
 */
async function dispatchEmail(payload: EmailPayload): Promise<void> {
  switch (payload.type) {
    case "gift_received":
      await sendGiftReceivedEmail(payload.to, payload.data);
      return;
    case "unlock_reminder":
      await sendUnlockReminderEmail(payload.to, payload.data);
      return;
    case "claim_confirmation":
      await sendClaimConfirmationEmail(payload.to, payload.data);
      return;
    default: {
      const _exhaustive: never = payload;
      throw new Error(`Unknown email payload type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Send a notification via the specified channel with retry and idempotency.
 *
 * Idempotency contract:
 *  - If `options.dedupKey` is provided and a cached result exists in Redis,
 *    the cached result is returned immediately without contacting the provider.
 *  - On a successful (or permanently-failed) delivery, the result is stored in
 *    Redis for `DEDUP_TTL_SECONDS` seconds.
 *
 * Retry contract:
 *  - Up to `MAX_ATTEMPTS` (3) delivery attempts are made.
 *  - Between attempts, the caller sleeps for `BASE_BACKOFF_MS × 2^attempt` ms.
 *  - If all attempts fail, a `DeliveryResult` with `status: "failed"` is returned.
 *  - Provider errors are *never* re-thrown to the caller.
 *
 * Gift-state safety:
 *  - This function never reads or writes gift records; it only dispatches
 *    notifications. A `"failed"` result must be handled by the caller.
 *
 * @param channel - The delivery channel (`NotificationChannel.Sms` or `NotificationChannel.Email`).
 * @param payload - The channel-specific notification payload.
 * @param options - Optional configuration (e.g. `dedupKey`).
 * @returns A `DeliveryResult` describing the outcome.
 */
export async function sendNotification(
  channel: NotificationChannel,
  payload: NotificationPayload,
  options: SendNotificationOptions = {}
): Promise<DeliveryResult> {
  const provider = channel === NotificationChannel.Sms ? "termii" : "resend";
  const { dedupKey } = options;

  // ── Idempotency check ───────────────────────────────────────────────────────
  if (dedupKey) {
    try {
      const redisKey = buildDedupRedisKey(dedupKey);
      const redis = await getRedisClient();
      const cached = await redis.get(redisKey);

      if (cached) {
        const parsed = JSON.parse(cached) as CachedDeliveryResult;
        log.info(
          { dedupKey, provider, status: parsed.status },
          "[notification] Returning cached result (dedup hit)"
        );
        // Return a clean DeliveryResult without the internal `cachedAt` field
        return {
          status: parsed.status,
          provider: parsed.provider,
          attempts: parsed.attempts,
          error: parsed.error,
          otp: parsed.otp,
        };
      }
    } catch (redisErr) {
      // Redis lookup failure is non-fatal — we fall through and attempt delivery
      log.warn(
        { dedupKey, provider, err: (redisErr as Error).message },
        "[notification] Redis dedup check failed; proceeding without idempotency guarantee"
      );
    }
  }

  // ── Retry loop ──────────────────────────────────────────────────────────────
  let lastError: Error | undefined;
  let otp: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(backoffDelayMs(attempt - 1));
    }

    try {
      if (channel === NotificationChannel.Sms) {
        otp = await dispatchSms(payload as SmsPayload);
      } else {
        await dispatchEmail(payload as EmailPayload);
      }

      // Delivery succeeded
      const result: DeliveryResult = {
        status: "sent",
        provider,
        attempts: attempt + 1,
        otp,
      };

      // ── Store successful result in Redis ──────────────────────────────────
      if (dedupKey) {
        await storeDedupResult(dedupKey, result).catch((cacheErr: unknown) => {
          log.warn(
            { dedupKey, provider, err: (cacheErr as Error).message },
            "[notification] Failed to cache dedup result after successful send"
          );
        });
      }

      log.info(
        { dedupKey, provider, attempts: attempt + 1 },
        "[notification] Delivered successfully"
      );

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.warn(
        { dedupKey, provider, attempt: attempt + 1, err: lastError.message },
        "[notification] Delivery attempt failed"
      );
    }
  }

  // ── All attempts exhausted ──────────────────────────────────────────────────
  const failedResult: DeliveryResult = {
    status: "failed",
    provider,
    attempts: MAX_ATTEMPTS,
    error: lastError?.message ?? "Unknown error",
  };

  // Cache the failed result to prevent hammering a downed provider
  if (dedupKey) {
    await storeDedupResult(dedupKey, failedResult).catch((cacheErr: unknown) => {
      log.warn(
        { dedupKey, provider, err: (cacheErr as Error).message },
        "[notification] Failed to cache dedup result after failed delivery"
      );
    });
  }

  log.error(
    { dedupKey, provider, attempts: MAX_ATTEMPTS, err: failedResult.error },
    "[notification] All delivery attempts exhausted"
  );

  return failedResult;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Persists a `DeliveryResult` to Redis under the deduplication key.
 * Errors from Redis are surfaced to the caller for graceful handling.
 */
async function storeDedupResult(dedupKey: string, result: DeliveryResult): Promise<void> {
  const redisKey = buildDedupRedisKey(dedupKey);
  const record: CachedDeliveryResult = { ...result, cachedAt: Date.now() };
  const redis = await getRedisClient();
  await redis.set(redisKey, JSON.stringify(record), { EX: DEDUP_TTL_SECONDS });
  log.info({ dedupKey, status: result.status }, "[notification] Dedup result cached");
}
