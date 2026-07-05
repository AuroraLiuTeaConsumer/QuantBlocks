"use client";

import { TIMEFRAMES } from "@/lib/market-data/types";

export function ChartIntervalSelector({
  value,
  onChange,
  loading = false,
}: {
  value: string;
  onChange: (timeframe: string) => void;
  loading?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        Price interval
      </span>
      <div className="min-w-0 overflow-x-auto">
        <div
          role="group"
          aria-label="Market price chart interval"
          aria-busy={loading}
          className="flex w-max items-center gap-0.5"
        >
          {TIMEFRAMES.map((timeframe) => {
            const active = timeframe === value;
            return (
              <button
                key={timeframe}
                type="button"
                aria-label={`Show ${timeframe} market price bars`}
                aria-pressed={active}
                disabled={loading}
                onClick={() => onChange(timeframe)}
                className={`min-w-8 shrink-0 rounded px-1.5 py-1 font-mono text-[10px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  active
                    ? "bg-accent text-white"
                    : "text-ink-3 hover:bg-surface-alt hover:text-ink-1"
                } disabled:cursor-wait`}
              >
                {timeframe}
              </button>
            );
          })}
        </div>
      </div>
      {loading && (
        <span
          className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent"
          aria-label="Loading price bars"
        />
      )}
    </div>
  );
}
