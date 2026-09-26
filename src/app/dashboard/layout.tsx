"use client";

import type { Metadata } from "next";
import { useAuthGuard } from "@/hooks/useAuthGuard";

// Note: metadata export is only valid in Server Components.
// It is kept here as a comment for documentation; the title is set via
// the parent layout in src/app/layout.tsx.
// export const metadata: Metadata = { title: "Dashboard" };

/**
 * DashboardLayout — wraps all /dashboard/* routes with an auth guard.
 *
 * - While the session is loading a neutral skeleton is shown so the page
 *   never flashes protected content to unauthenticated visitors.
 * - Unauthenticated users are immediately redirected to /auth/login with
 *   a validated same-origin callbackUrl so they return to the dashboard
 *   after signing in.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuthGuard();

  if (status === "loading" || status === "unauthenticated") {
    // Render a neutral placeholder while session resolves or redirect fires.
    // This prevents a flash of protected dashboard content.
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-live="polite"
        aria-label="Loading, please wait"
        role="status"
      >
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return <>{children}</>;
}
