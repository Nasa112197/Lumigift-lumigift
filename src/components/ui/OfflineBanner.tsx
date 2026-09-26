"use client";

/**
 * OfflineBanner
 *
 * A fixed status banner that:
 * - Appears when the user loses connectivity, telling them their action
 *   has NOT been sent (unknown outcome vs. confirmed failure).
 * - Changes to a "back online" state when connectivity is restored,
 *   prompting the user to retry rather than automatically re-submitting
 *   (which would duplicate side-effects like payments).
 * - Disappears automatically once the "just reconnected" window closes.
 *
 * Usage:
 *   Place once near the top of a layout or inside any page that performs
 *   mutations (payment, claim).
 *
 *   <OfflineBanner onRetry={handleRetry} />
 */

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import styles from "./OfflineBanner.module.css";

interface OfflineBannerProps {
  /**
   * Optional callback invoked when the user clicks the "Retry" button
   * after connectivity is restored. If omitted the retry button is not
   * shown.
   */
  onRetry?: () => void;
}

export function OfflineBanner({ onRetry }: OfflineBannerProps) {
  const { isOnline, justReconnected } = useNetworkStatus();

  // Nothing to show when fully online and not freshly reconnected
  if (isOnline && !justReconnected) return null;

  if (!isOnline) {
    return (
      <div
        className={`${styles.banner} ${styles.offline}`}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
      >
        <span className={styles.icon} aria-hidden="true">
          📡
        </span>
        <span>
          <strong>You&apos;re offline.</strong> Your last action may not have been sent — please
          wait for your connection to return before retrying.
        </span>
      </div>
    );
  }

  // justReconnected === true
  return (
    <div
      className={`${styles.banner} ${styles.online}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.icon} aria-hidden="true">
        ✅
      </span>
      <span>
        <strong>Connection restored.</strong>{" "}
        {onRetry ? "Click Retry to resend your last action." : "You are back online."}
      </span>
      {onRetry && (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
