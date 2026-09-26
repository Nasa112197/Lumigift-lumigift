"use client";

import { useToast } from "./ToastContext";
import type { ToastVariant } from "./ToastContext";
import styles from "./Toaster.module.css";

const ICONS: Record<ToastVariant, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

/**
 * Severity labels read aloud by screen readers before the message, so
 * "Error: Payment failed" is distinguishable from "Success: Gift created".
 */
const SEVERITY_LABELS: Record<ToastVariant, string> = {
  success: "Success",
  error: "Error",
  warning: "Warning",
  info: "Info",
};

/**
 * Errors and warnings use role="alert" (implicit aria-live="assertive") so
 * they interrupt the screen reader immediately. Success and info use
 * role="status" (implicit aria-live="polite") so they are read at the next
 * available opportunity without interrupting the user.
 *
 * aria-atomic="true" ensures the entire message is announced as one unit
 * when the toast appears or its content updates.
 *
 * The outer container uses aria-label="Notifications" as a landmark label
 * but deliberately has no aria-live attribute — each child handles its own
 * live region to avoid double announcements.
 */
function toastRole(variant: ToastVariant): "alert" | "status" {
  return variant === "error" || variant === "warning" ? "alert" : "status";
}

export function Toaster() {
  const { toasts, removeToast } = useToast();

  return (
    <div className={styles.container} aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toastRole(toast.variant)}
          aria-atomic="true"
          aria-live={toast.variant === "error" || toast.variant === "warning" ? "assertive" : "polite"}
          className={`${styles.toast} ${styles[toast.variant]}`}
        >
          <span className={styles.icon} aria-hidden="true">
            {ICONS[toast.variant]}
          </span>
          {/* Screen-reader–only severity prefix so announcements are distinguishable */}
          <span className="sr-only">{SEVERITY_LABELS[toast.variant]}: </span>
          <span className={styles.message}>{toast.message}</span>
          <button
            className={styles.close}
            onClick={() => removeToast(toast.id)}
            aria-label={`Dismiss ${SEVERITY_LABELS[toast.variant].toLowerCase()} notification`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
