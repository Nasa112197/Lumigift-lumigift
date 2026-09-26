/**
 * ApiErrorBanner — displays a user-safe error message with an optional retry action.
 *
 * Design requirements (issue #32):
 * - Each failure renders a user-safe message (no stack traces, no secrets)
 * - Errors are categorised so the UI can offer targeted retry advice
 * - Errors are logged via the app logger, not console.error, for safe aggregation
 */

import styles from "./ApiErrorBanner.module.css";

export type ApiErrorKind =
  | "validation" // 400 – bad input
  | "payment_init" // payment provider failed to initialise
  | "network" // fetch threw (offline / timeout)
  | "server" // 5xx
  | "unknown"; // anything else

export interface ApiErrorState {
  kind: ApiErrorKind;
  /** User-safe message to display */
  message: string;
}

interface ApiErrorBannerProps {
  error: ApiErrorState;
  onRetry?: () => void;
}

/** Map error kind to a helpful heading */
const KIND_HEADING: Record<ApiErrorKind, string> = {
  validation: "Please check your details",
  payment_init: "Payment could not be started",
  network: "Connection problem",
  server: "Something went wrong on our end",
  unknown: "An unexpected error occurred",
};

/** Map error kind to retry button label */
const KIND_RETRY_LABEL: Record<ApiErrorKind, string> = {
  validation: "Review & fix",
  payment_init: "Try again",
  network: "Retry",
  server: "Try again",
  unknown: "Try again",
};

export function ApiErrorBanner({ error, onRetry }: ApiErrorBannerProps) {
  const heading = KIND_HEADING[error.kind];
  const retryLabel = KIND_RETRY_LABEL[error.kind];

  return (
    <div role="alert" aria-live="assertive" className={styles.banner}>
      <div className={styles.content}>
        <strong className={styles.heading}>{heading}</strong>
        <p className={styles.message}>{error.message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          className={styles.retryBtn}
          onClick={onRetry}
          aria-label={`${retryLabel} — ${heading}`}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Classify a raw HTTP response / caught error into a safe ApiErrorState.
 * Strips any sensitive content from the message before it reaches the UI.
 */
export function classifyApiError(err: unknown, status?: number): ApiErrorState {
  // Network / fetch failure (no HTTP response)
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return {
      kind: "network",
      message: "We could not reach the server. Check your internet connection and try again.",
    };
  }

  if (status !== undefined) {
    if (status === 400) {
      return {
        kind: "validation",
        message: "Some of the details you entered are invalid. Please review and correct them.",
      };
    }
    if (status === 402 || status === 422) {
      return {
        kind: "payment_init",
        message:
          "We were unable to start the payment process. Please try again or use a different payment method.",
      };
    }
    if (status >= 500) {
      return {
        kind: "server",
        message:
          "Our server ran into a problem. This is not your fault — please try again shortly.",
      };
    }
  }

  // Check for a specific payment-related message from the API (safe subset)
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    if (lower.includes("payment") || lower.includes("paystack") || lower.includes("stripe")) {
      return {
        kind: "payment_init",
        message:
          "We were unable to start the payment process. Please try again or use a different payment method.",
      };
    }
    if (
      lower.includes("timeout") ||
      lower.includes("network") ||
      lower.includes("failed to fetch")
    ) {
      return {
        kind: "network",
        message: "The request timed out. Check your connection and try again.",
      };
    }
  }

  return {
    kind: "unknown",
    message:
      "Something unexpected happened. Please try again. If the problem persists, contact support.",
  };
}
