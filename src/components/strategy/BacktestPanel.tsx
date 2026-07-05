"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TwoPaneChart } from "./TwoPaneChart";
import type { BarItem } from "./TwoPaneChart";

const POLL_INTERVAL_MS = 1500;

type EquityPoint = { time: string; equity: number };
type RunStatus = "idle" | "running" | "success" | "error";

type DataQuality = {
  totalChecked: number;
  ohlcErrors: number;
  negativePrices: number;
  volumeErrors: number;
  spikeWarnings: number;
};

type BacktestRun = {
  id: string;
  status: string;
  metrics?: Record<string, unknown> | null;
  log?: {
    equityCurve?: EquityPoint[];
    error?: string;
    initialCapital?: number;
    dataSource?: "real" | "sample";
    dataSourceLabel?: string;
    dataQuality?: DataQuality | null;
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
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
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

function MetricCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean | null;
}) {
  const tone =
    positive === true
      ? { bg: "var(--green-bg)", color: "var(--green)" }
      : positive === false
      ? { bg: "var(--red-bg)", color: "var(--red)" }
      : { bg: "var(--surface-2)", color: "var(--text-1)" };

  return (
    <div
      className="flex flex-col items-center rounded-lg px-3.5 py-2"
      style={{ background: tone.bg, minWidth: 76 }}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </span>
      <span
        className="mt-1 font-mono text-[15px] font-bold tabular-nums"
        style={{ color: tone.color }}
      >
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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
  const [dataSourceLabel, setDataSourceLabel] = useState<string | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQuality | null>(null);
  const [fromDate, setFromDate] = useState(() => daysAgoStr(90));
  const [toDate, setToDate] = useState(() => todayStr());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const strategyIdRef = useRef(strategyId);
  const strategyTimeframeRef = useRef(strategyTimeframe);
  const runStrategyIdRef = useRef<string | null>(null);
  const runStrategyTimeframeRef = useRef<string | null>(null);
  const previousTimeframeRef = useRef(strategyTimeframe);

  strategyIdRef.current = strategyId;
  strategyTimeframeRef.current = strategyTimeframe;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (previousTimeframeRef.current === strategyTimeframe) return;
    previousTimeframeRef.current = strategyTimeframe;
    stopPolling();
    runStrategyIdRef.current = null;
    runStrategyTimeframeRef.current = null;
    setRunId(null);
    setMetrics(null);
    setEquityCurve([]);
    setTrades([]);
    setBars(undefined);
    setBarsUnavailable(false);
    setError(null);
    setDataSourceLabel(null);
    setDataQuality(null);
    setStatus("idle");
  }, [strategyTimeframe, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const fetchTrades = useCallback(async (rid: string) => {
    const res = await fetch(`/api/backtests/${rid}/trades`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && mountedRef.current) setTrades(data as Trade[]);
  }, []);

  const fetchBars = useCallback(async (
    sid: string,
    timeframe: string,
    startTime?: string | null,
    endTime?: string | null,
  ) => {
    const params = new URLSearchParams({ timeframe, limit: "2000" });
    if (startTime) params.set("start", startTime);
    if (endTime) {
      // BacktestRun.endTime is the final candle's open time; the bars endpoint
      // uses an exclusive end boundary, so advance it by 1 ms to include it.
      params.set("end", new Date(new Date(endTime).getTime() + 1).toISOString());
    }
    const res = await fetch(`/api/strategies/${sid}/bars?${params.toString()}`);
    if (!mountedRef.current) return;
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
    if (
      runStrategyIdRef.current !== sid ||
      runStrategyTimeframeRef.current !== timeframe
    )
      return;
    if (Array.isArray(data)) {
      setBars(data as BarItem[]);
      setBarsUnavailable(false);
    }
  }, []);

  const handleRunComplete = useCallback(
    (run: BacktestRun, rid: string) => {
      setMetrics(run.metrics ?? null);
      setStatus("success");
      setDataSourceLabel(run.log?.dataSourceLabel ?? null);
      setDataQuality(run.log?.dataQuality ?? null);

      const logCurve = run.log?.equityCurve;
      if (Array.isArray(logCurve) && logCurve.length > 0) {
        setEquityCurve(logCurve);
      }

      const sid = runStrategyIdRef.current ?? strategyIdRef.current;
      const tf = runStrategyTimeframeRef.current ?? strategyTimeframeRef.current;
      fetchBars(sid, tf, run.startTime, run.endTime);

      const initialCapital = getInitialCapital(run);
      fetchTrades(rid).then(() => {
        if (!mountedRef.current) return;
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
            typeof run.log === "object" && run.log && "error" in run.log
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
    setDataSourceLabel(null);
    setDataQuality(null);
    setStatus("running");

    try {
      const body: Record<string, string> = {};
      if (fromDate) body.startTime = new Date(fromDate).toISOString();
      if (toDate) {
        // include the full end day by moving to end-of-day
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        body.endTime = end.toISOString();
      }

      const res = await fetch(`/api/strategies/${strategyId}/backtests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        ((data as Record<string, unknown>).runId as string | undefined) ??
        ((data as Record<string, unknown>).id as string | undefined);
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

  const totalReturn = metrics?.totalReturnPct as number | undefined;
  const netPnl = metrics?.netPnl as number | undefined;
  const sharpe = metrics?.sharpe as number | undefined;
  const sortino = metrics?.sortino as number | undefined;
  const calmar = metrics?.calmar as number | undefined;
  const maxDD = metrics?.maxDrawdownPct as number | undefined;
  const winRate = metrics?.winRate as number | undefined;
  const numTrades = metrics?.numberOfTrades as number | undefined;
  const benchmarkReturn = metrics?.benchmarkReturnPct as number | undefined;
  const fundingCost = metrics?.fundingCostPaid as number | undefined;

  return (
    <div className="flex shrink-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background:
                status === "running"
                  ? "var(--accent-bg)"
                  : status === "success"
                  ? "var(--green-bg)"
                  : status === "error"
                  ? "var(--red-bg)"
                  : "var(--surface-2)",
              color:
                status === "running"
                  ? "var(--accent)"
                  : status === "success"
                  ? "var(--green)"
                  : status === "error"
                  ? "var(--red)"
                  : "var(--text-2)",
            }}
          >
            {status === "idle" && "Idle"}
            {status === "running" && "Running…"}
            {status === "success" && "Completed"}
            {status === "error" && "Error"}
          </span>
          {/* Data source badge — shown after a successful run */}
          {status === "success" && dataSourceLabel && (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                background: dataSourceLabel.startsWith("Sample")
                  ? "var(--amber-bg)"
                  : "var(--accent-bg)",
                color: dataSourceLabel.startsWith("Sample")
                  ? "var(--amber)"
                  : "var(--accent)",
              }}
            >
              {dataSourceLabel.startsWith("Sample") ? "⚠ Sample" : "● Live"}&nbsp;
              {dataSourceLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="font-medium text-ink-3">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={status === "running"}
              max={toDate || undefined}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <span className="font-medium text-ink-3">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={status === "running"}
              min={fromDate || undefined}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>

          <div className="h-4 w-px bg-line" />

          {status === "success" && runId && (
            <a
              href={`/api/backtests/${runId}/export`}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor">
                <path d="M5.5 1v6M2 7l3.5 3 3.5-3M1 10h9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
              </svg>
              Export CSV
            </a>
          )}
          <button
            type="button"
            onClick={handleRunBacktest}
            disabled={status === "running" || disableRun}
            className="inline-flex items-center gap-1.5 rounded-md bg-profit px-3 py-1.5 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(8,153,129,0.25)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "running" ? (
              <>
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Running…
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor">
                  <polygon points="2,1 10,5.5 2,10" />
                </svg>
                Run Backtest
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-loss/30 bg-loss-bg px-4 py-2 text-xs text-loss">
          {error}
        </div>
      )}

      {/* Chart */}
      {status === "success" && toChartEquity(equityCurve).length > 0 && (
        <div className="border-b border-line">
          {barsUnavailable && (
            <p className="px-4 py-1 text-[11px] text-warn">
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

      {/* Metrics */}
      {status === "success" && metrics != null && (
        <div className="grid grid-cols-3 gap-2 border-b border-line px-4 py-3 sm:grid-cols-5">
          {/* Row 1 */}
          <MetricCard
            label="Return"
            value={formatPct(totalReturn)}
            positive={typeof totalReturn === "number" ? totalReturn >= 0 : null}
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
            label="Sortino"
            value={formatNum(sortino)}
            positive={typeof sortino === "number" ? sortino >= 0 : null}
          />
          <MetricCard
            label="Calmar"
            value={formatNum(calmar)}
            positive={typeof calmar === "number" ? calmar >= 0 : null}
          />
          {/* Row 2 */}
          <MetricCard label="Max DD" value={formatPct(maxDD)} positive={false} />
          <MetricCard
            label="Win Rate"
            value={formatPct(typeof winRate === "number" ? winRate * 100 : winRate)}
            positive={typeof winRate === "number" ? winRate >= 0.5 : null}
          />
          <MetricCard label="Trades" value={formatNum(numTrades, 0)} />
          <MetricCard
            label="Benchmark"
            value={formatPct(benchmarkReturn)}
            positive={typeof benchmarkReturn === "number" ? benchmarkReturn >= 0 : null}
          />
          <MetricCard
            label="Funding"
            value={
              typeof fundingCost === "number" && fundingCost !== 0
                ? `${fundingCost > 0 ? "-" : "+"}${formatNum(Math.abs(fundingCost))}`
                : "—"
            }
            positive={typeof fundingCost === "number" ? fundingCost <= 0 : null}
          />
        </div>
      )}

      {/* Data quality */}
      {status === "success" && dataQuality && dataQuality.totalChecked > 0 && (() => {
        const { totalChecked, ohlcErrors, negativePrices, volumeErrors, spikeWarnings } = dataQuality;
        const clean = ohlcErrors === 0 && negativePrices === 0 && volumeErrors === 0 && spikeWarnings === 0;
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
              Data Quality
            </span>
            <span className="text-[11px] text-ink-2">
              {totalChecked.toLocaleString()} bars checked
            </span>
            {clean ? (
              <span className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>
                ✓ Clean
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3">
                {ohlcErrors > 0 && (
                  <span className="text-[11px]" style={{ color: "var(--red)" }}>
                    {ohlcErrors} OHLC error{ohlcErrors !== 1 ? "s" : ""}
                  </span>
                )}
                {negativePrices > 0 && (
                  <span className="text-[11px]" style={{ color: "var(--red)" }}>
                    {negativePrices} negative price{negativePrices !== 1 ? "s" : ""}
                  </span>
                )}
                {volumeErrors > 0 && (
                  <span className="text-[11px]" style={{ color: "var(--amber)" }}>
                    {volumeErrors} volume error{volumeErrors !== 1 ? "s" : ""}
                  </span>
                )}
                {spikeWarnings > 0 && (
                  <span className="text-[11px]" style={{ color: "var(--amber)" }}>
                    {spikeWarnings} price spike{spikeWarnings !== 1 ? "s" : ""}
                  </span>
                )}
              </span>
            )}
          </div>
        );
      })()}

      {/* Trades */}
      {status === "success" && trades.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
            Trades ({trades.length})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-[10px] uppercase text-ink-3">
                  <th className="px-3 py-2 font-semibold">Side</th>
                  <th className="px-3 py-2 font-semibold">Entry Time</th>
                  <th className="px-3 py-2 text-right font-semibold">Entry $</th>
                  <th className="px-3 py-2 font-semibold">Exit Time</th>
                  <th className="px-3 py-2 text-right font-semibold">Exit $</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const pnlPositive = typeof t.pnl === "number" && t.pnl >= 0;
                  const isLong =
                    t.side.toLowerCase() === "long" ||
                    t.side.toLowerCase() === "buy";
                  return (
                    <tr
                      key={t.id ?? i}
                      className="border-b border-line/60 transition-colors hover:bg-surface-alt"
                    >
                      <td className="px-3 py-1.5">
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: isLong ? "var(--green-bg)" : "var(--red-bg)",
                            color: isLong ? "var(--green)" : "var(--red)",
                          }}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
                        {formatTime(t.entryTime)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-1">
                        {formatNum(t.entryPrice)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
                        {formatTime(t.exitTime)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-1">
                        {t.exitPrice != null ? formatNum(t.exitPrice) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-2">
                        {formatNum(t.qty, 4)}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums"
                        style={{ color: pnlPositive ? "var(--green)" : "var(--red)" }}
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

      {/* Empty / running states */}
      {status === "success" && trades.length === 0 && metrics != null && (
        <p className="px-4 py-6 text-center text-xs text-ink-3">
          No trades in this run.
        </p>
      )}

      {status === "idle" && !error && (
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-profit-bg">
            <span className="text-base text-profit">▷</span>
          </div>
          <div className="text-[13px] font-semibold text-ink-2">
            Run a backtest to see results
          </div>
          <div className="text-[11px] text-ink-3">
            Simulates your strategy against historical bars
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-ink-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-[2.5px] border-line-strong border-t-profit" />
          Simulating strategy on historical bars…
        </div>
      )}
    </div>
  );
}
