"use client";

/**
 * NotificationBell
 *
 * A bell icon button in the navbar that:
 *  - Shows an unread count badge when there are unread notifications
 *  - Polls /api/v1/notifications every 60 seconds for the unread count
 *  - Links to the /notifications page
 *  - Has a dynamic aria-label for screen readers
 *
 * Issue #153 — User notification center
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./NotificationBell.module.css";

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchUnreadCount() {
    try {
      const res = await fetch("/api/v1/notifications?limit=1");
      if (!res.ok) return;
      const json = (await res.json()) as
        | { success: true; data: { unreadCount: number } }
        | { success: false };

      if (json.success) {
        setUnreadCount(json.data.unreadCount);
      }
    } catch {
      // Network error — fail silently; badge stays at last known value
    }
  }

  useEffect(() => {
    fetchUnreadCount();

    intervalRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const ariaLabel =
    unreadCount === 0
      ? "Notifications"
      : `Notifications, ${unreadCount} unread`;

  return (
    <Link
      href="/notifications"
      className={styles.bell}
      aria-label={ariaLabel}
    >
      {/* Bell icon — pure CSS / unicode, no external dependency */}
      <span className={styles.icon} aria-hidden="true">
        🔔
      </span>

      {unreadCount > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
