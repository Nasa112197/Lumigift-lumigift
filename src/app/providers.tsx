"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "@/components/ui/ToastContext";
import { Toaster } from "@/components/ui/Toaster";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 30 seconds; mutations will
            // invalidate immediately so the dashboard reflects changes.
            staleTime: 30_000,
            // Retry failed queries once before surfacing an error.
            retry: 1,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        {children}
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>
  );
}
