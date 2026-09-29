"use client";

/**
 * /notifications — User notification centre
 *
 * Shows all lifecycle notifications for the authenticated user with:
 *  - Unread count in the page heading (aria-live so screen readers announce updates)
 *  - Read / unread visual distinction
 *  - "Mark all as read" action
 *  - "Mark as read" on individual items
 *  - Loading skeleton while fetching
 *  - Empty state when there are no notifications
 *
 * Issue #153 — User notification center
 */

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-NG", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const TYPE_LABELS: Record<string, string> = {
  gift_received: "Gift received",
  gift_unlocked: "Gift unlocked",
  gift_claimed: "Gift claimed",
  payment_confirmed: "Payment confirmed",
  otp: "Security",
  system: "System",
};

function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <li className={`${styles.item} ${styles.skeleton}`} aria-hidden="true">
      <div className={styles.skeletonBadge} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonLine} />
        <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/notifications");
      const json = (await res.json()) as
        | { success: true; data: NotificationsResponse }
        | { success: false; error: string };

      if (!json.success) {
        setError(json.error);
        return;
      }

      setNotifications(json.data.notifications);
      setUnreadCount(json.data.unreadCount);
      setTotal(json.data.total);
    } catch {
      setError("Failed to load notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const json = (await res.json()) as
        | { success: true; data: { unreadCount: number } }
        | { success: false; error: string };

      if (json.success) {
        setUnreadCount(json.data.unreadCount);
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
        );
      }
    } catch {
      // Non-fatal — reload to sync
      fetchNotifications();
    } finally {
      setMarkingAll(false);
    }
  }

  async function markRead(id: string) {
    setMarkingId(id);
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const json = (await res.json()) as
        | { success: true; data: { unreadCount: number } }
        | { success: false; error: string };

      if (json.success) {
        setUnreadCount(json.data.unreadCount);
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n
          )
        );
      }
    } catch {
      // Non-fatal
    } finally {
      setMarkingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={`container ${styles.container}`}>
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className={styles.header}>
          <h1 className={styles.heading}>
            Notifications
            {/* aria-live so screen readers announce changes to unread count */}
            <span
              className={styles.unreadBadge}
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 0 && unreadCount}
            </span>
          </h1>

          {unreadCount > 0 && !loading && (
            <button
              type="button"
              className={styles.markAllButton}
              onClick={markAllRead}
              disabled={markingAll}
              aria-busy={markingAll}
            >
              {markingAll ? "Marking…" : "Mark all as read"}
            </button>
          )}
        </div>

        {/* ── Error state ───────────────────────────────────────────────── */}
        {error && (
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        )}

        {/* ── Loading skeleton ─────────────────────────────────────────── */}
        {loading && (
          <ul className={styles.list} aria-label="Loading notifications" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <NotificationSkeleton key={i} />
            ))}
          </ul>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!loading && !error && notifications.length === 0 && (
          <div className={styles.emptyState} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">
              🔔
            </span>
            <p className={styles.emptyText}>You have no notifications yet.</p>
          </div>
        )}

        {/* ── Notification list ─────────────────────────────────────────── */}
        {!loading && notifications.length > 0 && (
          <>
            <ul
              className={styles.list}
              aria-label={`${total} notification${total !== 1 ? "s" : ""}`}
            >
              {notifications.map((n) => {
                const isUnread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className={`${styles.item} ${isUnread ? styles.unread : styles.read}`}
                  >
                    <div className={styles.itemHeader}>
                      <span className={styles.typeBadge} data-type={n.type}>
                        {getTypeLabel(n.type)}
                      </span>
                      <time
                        className={styles.timestamp}
                        dateTime={n.created_at}
                        title={n.created_at}
                      >
                        {formatDate(n.created_at)}
                      </time>
                    </div>

                    <p className={styles.message}>{n.message}</p>

                    {isUnread && (
                      <button
                        type="button"
                        className={styles.markReadButton}
                        onClick={() => markRead(n.id)}
                        disabled={markingId === n.id}
                        aria-busy={markingId === n.id}
                        aria-label="Mark this notification as read"
                      >
                        {markingId === n.id ? "Marking…" : "Mark as read"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className={styles.total}>
              Showing {notifications.length} of {total} notification
              {total !== 1 ? "s" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
