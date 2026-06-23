"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function StrategyWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[StrategyWorkspace error]", error);
  }, [error]);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)] p-8 text-center">
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
        <div className="text-sm font-semibold text-ink-1">Workspace failed to load</div>
        <div className="mt-1 max-w-[320px] text-xs text-ink-3">
          {error.message || "An unexpected error occurred."}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-line-strong bg-surface px-4 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
        >
          Retry
        </button>
        <Link
          href="/strategies"
          className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] hover:brightness-95"
        >
          Back to Strategies
        </Link>
      </div>
    </main>
  );
}
