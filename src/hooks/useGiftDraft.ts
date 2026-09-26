/**
 * useGiftDraft — persists non-sensitive draft fields to sessionStorage
 * so the gift wizard can recover its state after an accidental page refresh.
 *
 * Security rules (issue #33):
 *   - Payment secrets and OTPs are NEVER stored.
 *   - Raw recipient phone numbers are NEVER stored (only name, email, message,
 *     amount, unlock date, and the current wizard step).
 *   - sessionStorage is used instead of localStorage: data is scoped to the
 *     browser tab and cleared automatically when the tab is closed.
 *
 * The hook returns a tuple of [draft, saveDraft, clearDraft].
 */

import { useCallback } from "react";

const STORAGE_KEY = "lumigift_gift_draft_v1";

/**
 * Only safe, non-sensitive fields are persisted.
 * Phone, OTP, and payment details are deliberately excluded.
 */
export interface GiftDraft {
  /** Current wizard step (0-indexed) */
  step: number;
  recipientName?: string;
  /** Optional email — kept only if the user explicitly typed it */
  recipientEmail?: string;
  amountNgn?: number;
  message?: string;
  unlockAt?: string;
  templateId?: string;
}

function safeParse(raw: string | null): GiftDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Basic shape guard — must have a numeric step
    if (typeof parsed?.step !== "number") return null;
    return parsed as GiftDraft;
  } catch {
    return null;
  }
}

export function useGiftDraft() {
  const readDraft = useCallback((): GiftDraft | null => {
    if (typeof window === "undefined") return null;
    return safeParse(sessionStorage.getItem(STORAGE_KEY));
  }, []);

  const saveDraft = useCallback((draft: GiftDraft) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Quota exceeded or private-browsing restriction — fail silently
    }
  }, []);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  return { readDraft, saveDraft, clearDraft };
}
