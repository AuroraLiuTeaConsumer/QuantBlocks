"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 30_000;

export function MarketDataRefresher() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
    setLastRefreshed(new Date());
  }, [router]);

  // Set initial timestamp and start auto-refresh interval
  useEffect(() => {
    setLastRefreshed(new Date());
    const id = setInterval(refresh, INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {lastRefreshed && (
        <span>
          Updated{" "}
          {lastRefreshed.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded border border-gray-700 bg-gray-900 px-2.5 py-1 text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300 disabled:opacity-50"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isPending ? "animate-spin" : ""}
        >
          <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />
          <path d="M6 1.5 8 3.5M6 1.5 8-.5" />
        </svg>
        {isPending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
