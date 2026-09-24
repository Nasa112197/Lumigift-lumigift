"use client";

import { format } from "date-fns";
import type { CreateGiftInput } from "@/types/schemas";
import { Button } from "@/components/ui/Button";
import { ApiErrorBanner, type ApiErrorState } from "@/components/ui/ApiErrorBanner";
import { formatNGN, formatUSDC } from "@/lib/currency";
import styles from "./GiftPreview.module.css";

interface GiftPreviewProps {
  data: CreateGiftInput;
  usdcEquivalent: string;
  onEdit: () => void;
  onConfirm: () => void;
  /** Called when the user clicks the retry button inside the error banner */
  onRetry?: () => void;
  loading: boolean;
  /** Structured error state — replaces the old plain-string error prop */
  apiError?: ApiErrorState | null;
}

export function GiftPreview({
  data,
  usdcEquivalent,
  onEdit,
  onConfirm,
  onRetry,
  loading,
  apiError,
}: GiftPreviewProps) {
  const unlockDate = format(new Date(data.unlockAt), "MMM d, yyyy 'at' h:mm a");
  const usdcLabel =
    usdcEquivalent === "—" || usdcEquivalent === "…" ? usdcEquivalent : formatUSDC(usdcEquivalent);

  return (
    <div className={styles.preview}>
      <h2 className={styles.title}>Review Your Gift</h2>
      <p className={styles.subtitle}>Please confirm the details before proceeding to payment.</p>

      <dl className={styles.details}>
        <div className={styles.row}>
          <dt>Recipient</dt>
          <dd>{data.recipientName}</dd>
        </div>
        <div className={styles.row}>
          <dt>Phone</dt>
          <dd>{data.recipientPhone}</dd>
        </div>
        <div className={styles.row}>
          <dt>Amount</dt>
          <dd>
            {formatNGN(data.amountNgn)}
            <span className={styles.usdc}> ≈ {usdcLabel}</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Unlocks</dt>
          <dd>{unlockDate}</dd>
        </div>
        {data.message && (
          <div className={styles.row}>
            <dt>Message</dt>
            <dd className={styles.message}>{data.message}</dd>
          </div>
        )}
      </dl>

      {apiError && <ApiErrorBanner error={apiError} onRetry={onRetry} />}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onEdit} disabled={loading}>
          ← Edit
        </Button>
        <Button onClick={onConfirm} loading={loading}>
          Confirm &amp; Pay
        </Button>
      </div>
    </div>
  );
}
