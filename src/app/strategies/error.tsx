"use client";

import { useEffect } from "react";

export default function StrategiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[StrategiesPage error]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)] p-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-loss/40 bg-loss-bg">
        <svg
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--red)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 5v3.5" />
          <circle cx="8" cy="11" r=".75" fill="var(--red)" stroke="none" />
        </svg>
      </div>
      <div>
        <div className="text-sm font-semibold text-ink-1">Failed to load strategies</div>
        <div className="mt-1 max-w-[320px] text-xs text-ink-3">
          {error.message || "An unexpected error occurred."}
        </div>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-line-strong bg-surface px-4 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
      >
        Retry
      </button>
    </main>
  );
}
