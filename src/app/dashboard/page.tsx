"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { GiftCard } from "@/components/gift/GiftCard";
import { GiftCardSkeleton } from "@/components/gift/GiftCardSkeleton";
import styles from "./page.module.css";
import type { ApiResponse } from "@/types";
import type { GiftPage } from "@/server/services/gift.service";

const PAGE_SIZE = 10;

async function fetchGiftsCursor(cursor: string | null, pageSize: number): Promise<GiftPage> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/v1/gifts?${params.toString()}`);
  const json: ApiResponse<GiftPage> = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export default function DashboardPage() {
  // Stack of cursors visited — index 0 is always null (first page).
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [stackIndex, setStackIndex] = useState(0);

  const cursor = cursorStack[stackIndex];
  const pageNumber = stackIndex + 1;

  const { data, status, isFetching, isStale, refetch } = useQuery({
    queryKey: ["gifts", "cursor", cursor],
    queryFn: () => fetchGiftsCursor(cursor, PAGE_SIZE),
  });

  const canGoNext = Boolean(data?.nextCursor) && !isFetching;
  const canGoPrev = stackIndex > 0 && !isFetching;

  function goNext() {
    if (!data?.nextCursor) return;
    const newStack = [...cursorStack.slice(0, stackIndex + 1), data.nextCursor];
    setCursorStack(newStack);
    setStackIndex((i) => i + 1);
  }

  function goPrev() {
    if (stackIndex === 0) return;
    setStackIndex((i) => i - 1);
  }

  // ── Loading (initial fetch) ──────────────────────────────────────────────
  if (status === "pending") {
    return (
      <div className={styles.page}>
        <div className="container">
          <h1 className={styles.title}>Your Gifts</h1>
          <div className={styles.grid} aria-live="polite" aria-busy="true">
            <GiftCardSkeleton count={PAGE_SIZE} />
          </div>
        </div>
      </div>
    );
  }

  // ── Error / failed fetch ─────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className={styles.page}>
        <div className="container">
          <h1 className={styles.title}>Your Gifts</h1>
          <div className={styles.errorState} role="alert">
            <p className={styles.errorMessage}>Failed to load your gifts. Please try again.</p>
            <button
              className="btn btn--secondary"
              onClick={() => refetch()}
              aria-label="Retry loading gifts"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { gifts, total, nextCursor } = data!;

  return (
    <div className={styles.page}>
      <div className="container">
        <h1 className={styles.title}>Your Gifts</h1>

        {/* Stale/background-revalidation banner */}
        {isStale && isFetching && (
          <p className={styles.staleBanner} aria-live="polite" aria-atomic="true">
            Refreshing…
          </p>
        )}

        {gifts.length === 0 && stackIndex === 0 ? (
          // ── Empty state ───────────────────────────────────────────────────
          <div className={styles.empty} role="status" aria-label="No gifts found">
            <div className={styles.emptyIconWrapper} aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="8" width="18" height="4" rx="1" />
                <path d="M12 8v13" />
                <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
                <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>No gifts yet</h2>
            <p className={styles.emptyDescription}>
              Brighten someone&apos;s day by sending a surprise cash gift!
            </p>
            <Link href="/send" className="btn btn--primary">
              Send your first gift!
            </Link>
          </div>
        ) : (
          <>
            <p className={styles.count}>
              Page {pageNumber} · {total} gift{total !== 1 ? "s" : ""} total
            </p>

            {/* Skeleton replaces grid while fetching next/prev page */}
            <div className={styles.grid} aria-live="polite" aria-busy={isFetching}>
              {isFetching ? (
                <GiftCardSkeleton count={PAGE_SIZE} />
              ) : (
                gifts.map((gift) => <GiftCard key={gift.id} gift={gift} perspective="sender" />)
              )}
            </div>

            <nav className={styles.pagination} aria-label="Gift history pagination">
              <button
                className="btn btn--secondary"
                onClick={goPrev}
                disabled={!canGoPrev}
                aria-label="Previous page"
                aria-disabled={!canGoPrev}
              >
                ← Previous
              </button>

              <span aria-live="polite" aria-atomic="true">
                Page {pageNumber}
              </span>

              <button
                className="btn btn--secondary"
                onClick={goNext}
                disabled={!canGoNext}
                aria-label={nextCursor ? "Next page" : "No more pages"}
                aria-disabled={!canGoNext}
              >
                Next →
              </button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
