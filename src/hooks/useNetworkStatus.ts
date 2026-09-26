"use client";

/**
 * useNetworkStatus
 *
 * Detects online/offline connectivity changes and exposes the current
 * network state to React components.
 *
 * The hook subscribes to the browser's built-in `online` and `offline`
 * window events so components can:
 *   - Disable submit buttons while the user is offline.
 *   - Show a banner telling the user their connection was lost.
 *   - Offer a manual retry once the connection is restored without
 *     automatically re-firing mutations (preventing duplicate side-effects).
 */

import { useState, useEffect } from "react";

export interface NetworkStatus {
  /** `true` when the browser believes there is network connectivity. */
  isOnline: boolean;
  /**
   * `true` for one render cycle immediately after connectivity is restored,
   * allowing components to show a "You're back online — retry?" prompt
   * before clearing the state.
   */
  justReconnected: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    // navigator.onLine is available in all modern browsers; default true during SSR
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      // Clear the "just reconnected" flag after a short window so the component
      // can decide whether to prompt the user before it disappears.
      reconnectTimer = setTimeout(() => setJustReconnected(false), 4000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(reconnectTimer);
    };
  }, []);

  return { isOnline, justReconnected };
}
