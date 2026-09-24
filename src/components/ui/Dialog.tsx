"use client";

/**
 * Accessible Dialog component.
 *
 * - Traps focus inside the dialog while open.
 * - Returns focus to the trigger element on close.
 * - Closes on Escape key press.
 * - Sets aria-modal, role="dialog", and aria-labelledby for screen readers.
 */

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialog.module.css";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Element that triggered the dialog — focus returns here on close */
  triggerRef?: React.RefObject<HTMLElement | null>;
  title: string;
  children: ReactNode;
  /** id for aria-labelledby — auto-generated from title if omitted */
  labelId?: string;
}

export function Dialog({ open, onClose, triggerRef, title, children, labelId }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = labelId ?? `dialog-title-${title.toLowerCase().replace(/\s+/g, "-")}`;

  // Lock scroll and trap focus when open
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = (document.activeElement as HTMLElement) ?? null;

    // Move focus into the dialog on next tick so the element is painted
    const frameId = requestAnimationFrame(() => {
      if (!dialogRef.current) return;
      const firstFocusable = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      firstFocusable?.focus();
    });

    // Prevent background scroll
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(frameId);
      document.body.style.overflow = "";
      // Return focus to trigger or wherever focus was before
      const returnTarget = (triggerRef?.current as HTMLElement | null) ?? previouslyFocused;
      returnTarget?.focus();
    };
  }, [open, triggerRef]);

  // Focus trap: keep Tab/Shift+Tab cycling inside the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      ).filter((el) => !el.closest("[aria-hidden='true']"));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if we're on the first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if we're on the last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  // Backdrop click closes the dialog
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!open) return null;

  // Render into a portal so z-index / stacking context is predictable
  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      // Backdrop should not be reachable by keyboard
      aria-hidden="false"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        // dialogs need a tabIndex so they can receive focus themselves
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  );
}
