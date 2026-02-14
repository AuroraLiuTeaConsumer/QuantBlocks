"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TwoPaneChart } from "./TwoPaneChart";
import type { BarItem } from "./TwoPaneChart";

const POLL_INTERVAL_MS = 1500;

/** Equity curve from backend or built from trades: time as ISO string, equity as number */
type EquityPoint = { time: string; equity: number };

type RunStatus = "idle" | "running" | "success" | "error";

type BacktestRun = {
  id: string;
  status: string;
  metrics?: Record<string, unknown> | null;
  log?: {
    equityCurve?: EquityPoint[];
    error?: string;
    initialCapital?: number;
  } | null;
  startTime?: string | null;
  endTime?: string | null;
};

type Trade = {
  id?: string;
  side: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  qty: number;
  pnl: number;
};

function formatTime(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function formatPct(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNum(value: unknown, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

type MetricCardProps = {
  label: string;
  value: string;
  positive?: boolean | null;
};

function MetricCard({ label, value, positive }: MetricCardProps) {
  let valueColor = "text-gray-200";
  if (positive === true) valueColor = "text-green-400";
  if (positive === false) valueColor = "text-red-400";

  return (
    <div className="flex flex-col items-center rounded-lg bg-gray-800/60 px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className={`mt-1 text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </span>
    </div>
  );
}

function buildEquityCurveFromTrades(
  trades: Trade[],
  initialCapital: number
): EquityPoint[] {
  const closed = trades
    .filter((t) => t.exitTime != null)
    .sort(
      (a, b) =>
        new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime()
    );

  if (closed.length === 0) return [];

  const earliestEntry = closed.reduce((best, t) =>
    new Date(t.entryTime).getTime() < new Date(best.entryTime).getTime()
      ? t
      : best
  );

  const curve: EquityPoint[] = [
    { time: earliestEntry.entryTime, equity: initialCapital },
  ];

  let equity = initialCapital;
  for (const t of closed) {
    equity += t.pnl;
    curve.push({ time: t.exitTime!, equity });
  }

  return curve;
}

/**
 * Resolve the initial capital used for the backtest when building equity from trades.
 * Prefer run.log.initialCapital (from backend), then derive from metrics, else fallback.
 */
function getInitialCapital(run: BacktestRun): number {
  const fromLog = run.log?.initialCapital;
  if (typeof fromLog === "number" && Number.isFinite(fromLog) && fromLog > 0) {
    return fromLog;
  }
  const totalReturnPct = run.metrics?.totalReturnPct as number | undefined;
  const netPnl = run.metrics?.netPnl as number | undefined;
  if (
    typeof totalReturnPct === "number" &&
    Number.isFinite(totalReturnPct) &&
    totalReturnPct !== 0 &&
    typeof netPnl === "number" &&
    Number.isFinite(netPnl)
  ) {
    const derived = (netPnl * 100) / totalReturnPct;
    if (Number.isFinite(derived) && derived > 0) return derived;
  }
  return 10_000;
}

/** Convert equity curve (ISO time + equity) to chart format (UTC seconds + value). */
function toChartEquity(
  curve: EquityPoint[]
): { time: number; value: number }[] {
  return curve
    .filter((p) => p.time != null && p.time !== "")
    .map((p) => ({
      time: Math.floor(new Date(p.time).getTime() / 1000),
      value: p.equity,
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
}

export function BacktestPanel({
  strategyId,
  strategyTimeframe = "1h",
  disableRun = false,
}: {
  strategyId: string;
  strategyTimeframe?: string;
  disableRun?: boolean;
}) {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [bars, setBars] = useState<BarItem[] | undefined>(undefined);
  const [barsUnavailable, setBarsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const strategyIdRef = useRef(strategyId);
  const strategyTimeframeRef = useRef(strategyTimeframe);
  const runStrategyIdRef = useRef<string | null>(null);
  const runStrategyTimeframeRef = useRef<string | null>(null);

  strategyIdRef.current = strategyId;
  strategyTimeframeRef.current = strategyTimeframe;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const fetchTrades = useCallback(
    async (rid: string) => {
      const res = await fetch(`/api/backtests/${rid}/trades`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && mountedRef.current) setTrades(data as Trade[]);
    },
    [mountedRef]
  );

  const fetchBars = useCallback(
    async (sid: string, timeframe: string) => {
      const res = await fetch(
        `/api/strategies/${sid}/bars?timeframe=${encodeURIComponent(timeframe)}&limit=500`
      );
      if (!mountedRef.current) return;
      // Only apply result if this request still matches the current run (avoids race when switching strategies or running multiple backtests).
      const stillCurrent =
        runStrategyIdRef.current === sid &&
        runStrategyTimeframeRef.current === timeframe;
      if (!stillCurrent) return;
      if (!res.ok) {
        setBars(undefined);
        setBarsUnavailable(true);
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      if (runStrategyIdRef.current !== sid || runStrategyTimeframeRef.current !== timeframe) return;
      if (Array.isArray(data)) {
        setBars(data as BarItem[]);
        setBarsUnavailable(false);
      }
    },
    []
  );

  const handleRunComplete = useCallback(
    (run: BacktestRun, rid: string) => {
      setMetrics(run.metrics ?? null);
      setStatus("success");

      // Extract equity curve from log if available, else build from trades
      const logCurve = run.log?.equityCurve;
      if (Array.isArray(logCurve) && logCurve.length > 0) {
        setEquityCurve(logCurve);
      }

      // Use refs so polling completion (possibly with stale closure) fetches bars for the strategy we ran for
      const sid = runStrategyIdRef.current ?? strategyIdRef.current;
      const tf = runStrategyTimeframeRef.current ?? strategyTimeframeRef.current;
      fetchBars(sid, tf);

      const initialCapital = getInitialCapital(run);
      fetchTrades(rid).then(() => {
        if (!mountedRef.current) return;
        // If no server-side equity curve, build from trades after they load
        if (!Array.isArray(logCurve) || logCurve.length === 0) {
          setTrades((currentTrades) => {
            if (!mountedRef.current) return currentTrades;
            const curve = buildEquityCurveFromTrades(currentTrades, initialCapital);
            setEquityCurve(curve);
            return currentTrades;
          });
        }
      });
    },
    [fetchTrades, fetchBars]
  );

  const pollRun = useCallback(
    async (rid: string) => {
      const res = await fetch(`/api/backtests/${rid}`);
      if (!res.ok || !mountedRef.current) return;
      const run = (await res.json()) as BacktestRun;
      const isDone =
        run.status === "finished" ||
        run.status === "completed" ||
        run.status === "success";
      const isFail = run.status === "error" || run.status === "failed";
      if (isDone) {
        stopPolling();
        if (!mountedRef.current) return;
        // Run completed for a different strategy than currently viewed; discard result
        if (
          strategyIdRef.current !== runStrategyIdRef.current ||
          strategyTimeframeRef.current !== runStrategyTimeframeRef.current
        ) {
          setRunId(null);
          setStatus("idle");
          return;
        }
        handleRunComplete(run, rid);
        return;
      }
      if (isFail) {
        stopPolling();
        if (mountedRef.current) {
          const errMsg =
            typeof run.log === "object" &&
            run.log &&
            "error" in run.log
              ? String(run.log.error)
              : "Backtest failed";
          setError(errMsg);
          setStatus("error");
        }
      }
    },
    [stopPolling, handleRunComplete]
  );

  const startPolling = useCallback(
    (rid: string) => {
      stopPolling();
      pollTimerRef.current = setInterval(() => pollRun(rid), POLL_INTERVAL_MS);
      pollRun(rid);
    },
    [stopPolling, pollRun]
  );

  const handleRunBacktest = async () => {
    setError(null);
    setRunId(null);
    setMetrics(null);
    setEquityCurve([]);
    setTrades([]);
    setBars(undefined);
    setBarsUnavailable(false);
    setStatus("running");

    try {
      const res = await fetch(`/api/strategies/${strategyId}/backtests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as BacktestRun & {
        error?: string;
        details?: unknown;
      };

      if (!mountedRef.current) return;

      if (!res.ok) {
        const message =
          data.error ??
          (Array.isArray(data.details)
            ? (data.details as { message?: string }[])
                .map((d) => d.message)
                .join("; ")
            : `Request failed (${res.status})`);
        setError(String(message));
        setStatus("error");
        return;
      }

      const run = data as BacktestRun;
      const rid =
        (data as Record<string, unknown>).runId as string | undefined ??
        (data as Record<string, unknown>).id as string | undefined;
      if (!rid) {
        setError("No run id in response");
        setStatus("error");
        return;
      }

      setRunId(rid);
      runStrategyIdRef.current = strategyId;
      runStrategyTimeframeRef.current = strategyTimeframe;

      if (run.status === "completed" && run.metrics != null) {
        handleRunComplete(run, rid);
        return;
      }

      startPolling(rid);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Network error");
        setStatus("error");
      }
    }
  };

  // Metric helpers
  const totalReturn = metrics?.totalReturnPct as number | undefined;
  const sharpe = metrics?.sharpe as number | undefined;
  const maxDD = metrics?.maxDrawdownPct as number | undefined;
  const winRate = metrics?.winRate as number | undefined;
  const netPnl = metrics?.netPnl as number | undefined;
  const numTrades = metrics?.numberOfTrades as number | undefined;

  return (
    <div className="flex shrink-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Backtest
          </h2>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              status === "idle"
                ? "bg-gray-800 text-gray-500"
                : status === "running"
                  ? "bg-blue-900/40 text-blue-400"
                  : status === "success"
                    ? "bg-green-900/40 text-green-400"
                    : "bg-red-900/40 text-red-400"
            }`}
          >
            {status === "idle" && "Idle"}
            {status === "running" && "Running…"}
            {status === "success" && "Completed"}
            {status === "error" && "Error"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleRunBacktest}
          disabled={status === "running" || disableRun}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "running" ? "Running…" : "Run Backtest"}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Content area */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Two-pane chart: price (top) + equity (bottom) */}
        {status === "success" && toChartEquity(equityCurve).length > 0 && (
          <div className="border-b border-gray-800">
            {barsUnavailable && (
              <p className="px-4 py-1.5 text-xs text-amber-500">
                Price bars unavailable; showing equity only.
              </p>
            )}
            <TwoPaneChart
              mode="backtest"
              bars={bars}
              equity={toChartEquity(equityCurve)}
              trades={trades.map((t) => ({
                side:
                  t.side.toLowerCase() === "buy" || t.side.toLowerCase() === "long"
                    ? ("long" as const)
                    : ("short" as const),
                entryTime: t.entryTime,
                exitTime: t.exitTime,
                entryPrice: t.entryPrice,
                exitPrice: t.exitPrice,
              }))}
            />
          </div>
        )}

        {/* Metrics bar */}
        {status === "success" && metrics != null && (
          <div className="grid grid-cols-3 gap-2 border-b border-gray-800 px-4 py-3 sm:grid-cols-6">
            <MetricCard
              label="Return"
              value={formatPct(totalReturn)}
              positive={
                typeof totalReturn === "number" ? totalReturn >= 0 : null
              }
            />
            <MetricCard
              label="Net PnL"
              value={formatNum(netPnl)}
              positive={typeof netPnl === "number" ? netPnl >= 0 : null}
            />
            <MetricCard
              label="Sharpe"
              value={formatNum(sharpe)}
              positive={typeof sharpe === "number" ? sharpe >= 0 : null}
            />
            <MetricCard
              label="Max DD"
              value={formatPct(maxDD)}
              positive={false}
            />
            <MetricCard
              label="Win Rate"
              value={formatPct(winRate)}
              positive={
                typeof winRate === "number" ? winRate >= 50 : null
              }
            />
            <MetricCard
              label="Trades"
              value={formatNum(numTrades, 0)}
            />
          </div>
        )}

        {/* Trades table */}
        {status === "success" && trades.length > 0 && (
          <div className="px-4 py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Trades ({trades.length})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/40 text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Entry Time</th>
                    <th className="px-3 py-2 text-right">Entry Price</th>
                    <th className="px-3 py-2">Exit Time</th>
                    <th className="px-3 py-2 text-right">Exit Price</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => {
                    const pnlPositive =
                      typeof t.pnl === "number" && t.pnl >= 0;
                    const isLong =
                      t.side.toLowerCase() === "long" ||
                      t.side.toLowerCase() === "buy";
                    return (
                      <tr
                        key={t.id ?? i}
                        className="border-b border-gray-800/60 transition-colors hover:bg-gray-800/30"
                      >
                        <td className="px-3 py-1.5">
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                              isLong
                                ? "bg-green-900/30 text-green-400"
                                : "bg-red-900/30 text-red-400"
                            }`}
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">
                          {formatTime(t.entryTime)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                          {formatNum(t.entryPrice)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">
                          {formatTime(t.exitTime)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                          {t.exitPrice != null ? formatNum(t.exitPrice) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                          {formatNum(t.qty, 4)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                            pnlPositive ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {typeof t.pnl === "number"
                            ? `${t.pnl >= 0 ? "+" : ""}${formatNum(t.pnl)}`
                            : t.pnl}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty states */}
        {status === "success" && trades.length === 0 && metrics != null && (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            No trades in this run.
          </p>
        )}

        {status === "idle" && !error && (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            Run a backtest against the saved strategy graph.
          </p>
        )}

        {status === "running" && (
          <div className="flex items-center justify-center gap-2 px-4 py-10">
            <svg
              className="h-5 w-5 animate-spin text-blue-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm text-gray-400">
              Running backtest…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
