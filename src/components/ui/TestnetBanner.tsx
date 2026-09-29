"use client";

/**
 * TestnetBanner
 *
 * A dismissible amber warning banner rendered at the top of the layout
 * when the app is running against the Stellar testnet.
 *
 * Behaviour:
 *  - Reads NEXT_PUBLIC_STELLAR_NETWORK at render time.
 *  - Renders null if the value is "mainnet" (safe for production).
 *  - Persists the dismissed state in localStorage so the banner stays
 *    hidden after the user closes it within the same browser.
 *  - Respects ARIA semantics for screen-reader users (role="alert",
 *    aria-live="polite").
 *
 * Issue #154 — Onboarding & testnet safety messaging
 */

import { useState, useEffect } from "react";
import styles from "./TestnetBanner.module.css";

const DISMISSED_KEY = "lumigift_testnet_banner_dismissed";

export function TestnetBanner() {
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

  // Never show the banner on mainnet
  if (network === "mainnet") return null;

  return <TestnetBannerInner />;
}

/**
 * Inner component — only mounts when we know we're on testnet.
 * Separated so we can safely call hooks without breaking the early-return
 * guard above (hooks must be called unconditionally).
 */
function TestnetBannerInner() {
  const [dismissed, setDismissed] = useState<boolean>(true); // default hidden to avoid flash

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      setDismissed(stored === "true");
    } catch {
      // localStorage may be unavailable in some privacy modes — show banner by default
      setDismissed(false);
    }
  }, []);

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Non-fatal — banner just won't persist dismissed state
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div
      className={styles.banner}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.icon} aria-hidden="true">
        ⚠️
      </span>
      <span className={styles.message}>
        <strong>Testnet Mode</strong> — All funds are test tokens with no real
        value. Transactions are irreversible on-chain.
      </span>
      <button
        type="button"
        className={styles.dismissButton}
        onClick={handleDismiss}
        aria-label="Dismiss testnet warning"
      >
        ✕
      </button>
    </div>
  );
}
