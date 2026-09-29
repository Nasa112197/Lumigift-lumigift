"use client";

/**
 * ConfirmationSafetyNotice
 *
 * A small inline notice rendered inside payment or claim confirmation flows
 * to make the irreversibility of blockchain actions explicit.
 *
 * Props:
 *  - type: 'payment' | 'claim' — controls the message text
 *  - amount: optional formatted amount string (e.g. "12.50 USDC")
 *  - isTestnet: optional boolean — appends "(Testnet — no real value)" when true
 *
 * Issue #154 — Onboarding & testnet safety messaging
 */

import styles from "./ConfirmationSafetyNotice.module.css";

interface ConfirmationSafetyNoticeProps {
  /** Which flow this notice appears in — controls the message body. */
  type: "payment" | "claim";
  /**
   * Optional formatted amount string, e.g. "12.50 USDC".
   * When provided, the message includes the specific amount.
   * When omitted, the message uses a generic placeholder.
   */
  amount?: string;
  /**
   * When true, an additional "(Testnet — no real value)" suffix is appended
   * so users on the testnet never confuse test tokens with real value.
   * Defaults to false.
   */
  isTestnet?: boolean;
}

export function ConfirmationSafetyNotice({
  type,
  amount,
  isTestnet = false,
}: ConfirmationSafetyNoticeProps) {
  const amountText = amount ?? "the specified amount of USDC";

  const message =
    type === "payment"
      ? `This action will lock ${amountText} in a smart contract. This is irreversible once confirmed.`
      : `Claiming will transfer ${amountText} to your Stellar wallet. This transaction cannot be undone.`;

  const testnetSuffix = isTestnet ? " (Testnet — no real value)" : "";

  return (
    <p className={styles.notice} role="note" aria-label="Important safety information">
      <span className={styles.icon} aria-hidden="true">
        🔒
      </span>
      <span className={styles.text}>
        {message}
        {isTestnet && (
          <span className={styles.testnetSuffix}>{testnetSuffix}</span>
        )}
      </span>
    </p>
  );
}
