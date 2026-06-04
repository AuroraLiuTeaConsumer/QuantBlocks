"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  TwoPaneChart,
  type TwoPaneChartHandle,
  type ChartMarker,
} from "./TwoPaneChart";

const POLL_SESSION_MS = 1000;
const POLL_TRADES_MS = 3000;

type Position = {
  side: "long" | "short" | null;
  qty: number;
  entryPrice: number | null;
};

type SessionSnapshot = {
  id: string;
  strategyId: string;
  status: "idle" | "running" | "stopped" | "error";
  instrument: string;
  timeframe: string;
  lastPrice: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  position: Position;
  useRealBars: boolean;
  barCursor: string | null;
  startedAt: string | null;
  updatedAt: string;
};

type PaperTrade = {
  id: string;
  side: string;
  qty: number;
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  pnl: number;
};

/** Parse JSON from a fetch Response without throwing on empty/non-JSON bodies. */
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toUTCSec(date: string | Date): number {
  return Math.floor(new Date(date).getTime() / 1000);
}

function formatNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function pnlColor(v: number): string {
  if (v > 0) return "var(--green)";
  if (v < 0) return "var(--red)";
  return "var(--text-2)";
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-surface-alt px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </span>
      <span
        className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums"
        style={{ color: color ?? "var(--text-1)" }}
      >
        {value}
      </span>
    </div>
  );
}

export function PaperTradingPanel({
  strategyId,
  disableRun = false,
}: {
  strategyId: string;
  disableRun?: boolean;
}) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useRealBars, setUseRealBars] = useState(false);
  const [replayFrom, setReplayFrom] = useState("");

  const mountedRef = useRef(true);
  const sessionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chartRef = useRef<TwoPaneChartHandle>(null);
  const lastEquityTimeRef = useRef(0);
  const seenTradeIdsRef = useRef(new Set<string>());
  const seenExitIdsRef = useRef(new Set<string>());
  const allMarkersRef = useRef<ChartMarker[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (sessionPollRef.current) clearInterval(sessionPollRef.current);
      if (tradePollRef.current) clearInterval(tradePollRef.current);
    };
  }, []);

  const appendFromSnapshot = useCallback((snap: SessionSnapshot) => {
    const chart = chartRef.current;
    if (!chart) return;
    // Real-bar replay: use the actual historical candle timestamp from barCursor
    // so the x-axis shows the replayed date, not today's wall-clock time.
    // Synthetic mode has no barCursor so we fall back to wall-clock.
    const time = snap.barCursor ? toUTCSec(snap.barCursor) : toUTCSec(snap.updatedAt);
    if (time > lastEquityTimeRef.current) {
      chart.appendEquity({ time, value: snap.equity });
      chart.appendPrice({ time, value: snap.lastPrice });
      lastEquityTimeRef.current = time;
    }
  }, []);

  const syncMarkersFromTrades = useCallback((tradeList: PaperTrade[]) => {
    const chart = chartRef.current;
    if (!chart) return;
    let changed = false;
    for (const t of tradeList) {
      const isLong = t.side === "long";
      // Entry marker — add once per trade id
      if (!seenTradeIdsRef.current.has(t.id)) {
        seenTradeIdsRef.current.add(t.id);
        changed = true;
        allMarkersRef.current.push({
          time: toUTCSec(t.entryTime),
          position: isLong ? "belowBar" : "aboveBar",
          shape: isLong ? "arrowUp" : "arrowDown",
          color: isLong ? "#089981" : "#f23645",
          text: isLong ? "Long" : "Short",
        });
      }
      // Exit marker — added separately so a trade first seen as open
      // gets its exit marker on the next poll when exitTime is populated
      if (t.exitTime && !seenExitIdsRef.current.has(t.id)) {
        seenExitIdsRef.current.add(t.id);
        changed = true;
        allMarkersRef.current.push({
          time: toUTCSec(t.exitTime),
          position: isLong ? "aboveBar" : "belowBar",
          shape: isLong ? "arrowDown" : "arrowUp",
          color: "#94a3b8",
          text: "Exit",
        });
      }
    }
    if (changed) chart.setMarkers(allMarkersRef.current);
  }, []);

  const resetChart = useCallback(() => {
    chartRef.current?.reset();
    lastEquityTimeRef.current = 0;
    seenTradeIdsRef.current.clear();
    seenExitIdsRef.current.clear();
    allMarkersRef.current = [];
  }, []);

  const stopPolling = useCallback(() => {
    if (sessionPollRef.current) {
      clearInterval(sessionPollRef.current);
      sessionPollRef.current = null;
    }
    if (tradePollRef.current) {
      clearInterval(tradePollRef.current);
      tradePollRef.current = null;
    }
  }, []);

  const pollSession = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(`/api/paper/${sid}`);
        if (!res.ok || !mountedRef.current) return;
        const data = (await res.json()) as SessionSnapshot;
        if (!mountedRef.current) return;
        setSession(data);
        if (data.status === "running") appendFromSnapshot(data);
        if (data.status !== "running") stopPolling();
      } catch {
        // transient
      }
    },
    [stopPolling, appendFromSnapshot]
  );

  const pollTrades = useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(`/api/paper/${sid}/trades`);
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        if (Array.isArray(data) && mountedRef.current) {
          const tradeList = data as PaperTrade[];
          setTrades(tradeList);
          syncMarkersFromTrades(tradeList);
        }
      } catch {
        // transient
      }
    },
    [syncMarkersFromTrades]
  );

  const startPolling = useCallback(
    (sid: string) => {
      stopPolling();
      pollSession(sid);
      pollTrades(sid);
      sessionPollRef.current = setInterval(() => pollSession(sid), POLL_SESSION_MS);
      tradePollRef.current = setInterval(() => pollTrades(sid), POLL_TRADES_MS);
    },
    [stopPolling, pollSession, pollTrades]
  );

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    resetChart();
    try {
      const body: Record<string, unknown> = { useRealBars };
      if (useRealBars && replayFrom) body.replayFrom = replayFrom;
      const res = await fetch(`/api/strategies/${strategyId}/paper/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson(res);
      if (!mountedRef.current) return;
      if (!res.ok) {
        // 409 means a running session with different settings already exists.
        // The response includes its sessionId. Attach to it so the Stop controls
        // appear and the user can reconfigure rather than seeing a dead-end error.
        if (res.status === 409 && typeof data.sessionId === "string") {
          const existingId = data.sessionId;
          setError(
            (data.error as string | undefined) ??
              "A session is already running. Stop it to change settings."
          );
          setLoading(false);
          try {
            const snapRes = await fetch(`/api/paper/${existingId}`);
            if (snapRes.ok && mountedRef.current) {
              const snap = (await snapRes.json()) as SessionSnapshot;
              if (mountedRef.current) {
                setSession(snap);
                appendFromSnapshot(snap);
                if (snap.status === "running") startPolling(snap.id);
              }
            }
          } catch {
            // ignore — error message already shown
          }
          return;
        }
        setError((data.error as string | undefined) ?? "Failed to start");
        setLoading(false);
        return;
      }
      const snap = data as unknown as SessionSnapshot;
      setSession(snap);
      setTrades([]);
      setLoading(false);
      appendFromSnapshot(snap);
      if (snap.status === "running") startPolling(snap.id);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Network error");
        setLoading(false);
      }
    }
  };

  const handleStop = async () => {
    if (!session) return;
    setError(null);
    try {
      const res = await fetch(`/api/paper/${session.id}/stop`, { method: "POST" });
      const data = await safeJson(res);
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? "Failed to stop");
        return;
      }
      setSession(data as unknown as SessionSnapshot);
      stopPolling();
      pollTrades(session.id);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    }
  };

  const handleReset = async () => {
    if (!session) return;
    setError(null);
    try {
      const res = await fetch(`/api/paper/${session.id}/reset`, { method: "POST" });
      const data = await safeJson(res);
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? "Failed to reset");
        return;
      }
      setSession(data as unknown as SessionSnapshot);
      setTrades([]);
      stopPolling();
      resetChart();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    }
  };

  const status = session?.status ?? "idle";
  const isRunning = status === "running";
  const canStart = !isRunning && !disableRun && !loading;
  const canStop = isRunning;
  const canReset = session != null && !isRunning;
  const activeUseRealBars = session?.useRealBars ?? false;

  const statusStyle = (() => {
    switch (status) {
      case "running":
        return { bg: "var(--accent-bg)", color: "var(--accent)" };
      case "stopped":
        return { bg: "var(--warn-bg)", color: "var(--amber)" };
      case "error":
        return { bg: "var(--red-bg)", color: "var(--red)" };
      default:
        return { bg: "var(--surface-2)", color: "var(--text-2)" };
    }
  })();

  const showChart = session != null && status !== "idle";

  return (
    <div className="flex shrink-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
            style={{ background: statusStyle.bg, color: statusStyle.color }}
          >
            {status}
          </span>
          {isRunning && (
            <span
              className="h-2 w-2 animate-soft-pulse rounded-full"
              style={{ background: "var(--accent)" }}
            />
          )}
          {isRunning && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: activeUseRealBars ? "var(--accent-bg)" : "var(--surface-2)",
                color: activeUseRealBars ? "var(--accent)" : "var(--text-2)",
              }}
            >
              {activeUseRealBars ? "Real Bars" : "Synthetic"}
            </span>
          )}
        </div>

        {/* Real bars config — only shown when not running */}
        {!isRunning && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={useRealBars}
                onChange={(e) => setUseRealBars(e.target.checked)}
                className="accent-accent h-3.5 w-3.5 cursor-pointer"
              />
              <span className="select-none font-medium">Real Bars</span>
            </label>
            {useRealBars && (
              <input
                type="date"
                value={replayFrom}
                onChange={(e) => setReplayFrom(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Replay from (optional)"
              />
            )}
          </div>
        )}

        <div className="flex gap-2">
          {canReset && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
            >
              Reset
            </button>
          )}
          {canStop && (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 rounded-md border border-loss/40 bg-loss-bg px-3 py-1.5 text-xs font-semibold text-loss hover:brightness-95"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor">
                <rect x="1.5" y="1.5" width="8" height="8" rx="1" />
              </svg>
              Stop
            </button>
          )}
          {!isRunning && (
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(41,98,255,0.25)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="10" height="10" viewBox="0 0 11 11" fill="currentColor">
                <polygon points="2,1 10,5.5 2,10" />
              </svg>
              {loading ? "Starting…" : "Start Paper Trading"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-loss/30 bg-loss-bg px-4 py-2 text-xs text-loss">
          {error}
        </div>
      )}

      {/* Chart */}
      {showChart && (
        <div className="border-b border-line">
          <TwoPaneChart
            ref={chartRef}
            mode="paper"
            streaming
            heightTop={200}
            heightBottom={160}
          />
        </div>
      )}

      {/* Stats */}
      {session && status !== "idle" && (
        <div className="grid grid-cols-3 gap-2 border-b border-line px-4 py-3 sm:grid-cols-6">
          <StatCard label="Price" value={formatNum(session.lastPrice, 4)} />
          <StatCard label="Equity" value={formatNum(session.equity)} />
          <StatCard
            label="Realized"
            value={`${session.realizedPnl >= 0 ? "+" : ""}${formatNum(session.realizedPnl)}`}
            color={pnlColor(session.realizedPnl)}
          />
          <StatCard
            label="Unrealized"
            value={`${session.unrealizedPnl >= 0 ? "+" : ""}${formatNum(session.unrealizedPnl)}`}
            color={pnlColor(session.unrealizedPnl)}
          />
          <StatCard
            label="Position"
            value={
              session.position.side
                ? `${session.position.side.toUpperCase()} ${formatNum(session.position.qty, 4)}`
                : "Flat"
            }
            color={
              session.position.side === "long"
                ? "var(--green)"
                : session.position.side === "short"
                ? "var(--red)"
                : undefined
            }
          />
          <StatCard
            label="Entry"
            value={
              session.position.entryPrice != null
                ? formatNum(session.position.entryPrice, 4)
                : "—"
            }
          />
        </div>
      )}

      {/* Trades */}
      {trades.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3">
            Trades ({trades.length})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[550px] text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-alt text-[10px] uppercase text-ink-3">
                  <th className="px-3 py-2 font-semibold">Side</th>
                  <th className="px-3 py-2 font-semibold">Entry</th>
                  <th className="px-3 py-2 text-right font-semibold">Entry $</th>
                  <th className="px-3 py-2 font-semibold">Exit</th>
                  <th className="px-3 py-2 text-right font-semibold">Exit $</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const isLong = t.side === "long";
                  return (
                    <tr
                      key={t.id}
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
                        {formatNum(t.entryPrice, 4)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
                        {formatTime(t.exitTime)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-1">
                        {t.exitPrice != null ? formatNum(t.exitPrice, 4) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-2">
                        {formatNum(t.qty, 4)}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums"
                        style={{ color: pnlColor(t.pnl) }}
                      >
                        {t.pnl >= 0 ? "+" : ""}
                        {formatNum(t.pnl)}
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
      {status === "idle" && !session && (
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-bg">
            <span className="text-base text-accent">◉</span>
          </div>
          <div className="text-[13px] font-semibold text-ink-2">
            Paper trading not active
          </div>
          <div className="text-[11px] text-ink-3">
            Use synthetic bars or enable Real Bars to replay from TimescaleDB
          </div>
        </div>
      )}

      {isRunning && trades.length === 0 && (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-ink-2">
          <span
            className="h-2 w-2 animate-soft-pulse rounded-full"
            style={{ background: "var(--accent)" }}
          />
          Waiting for trades…
        </div>
      )}
    </div>
  );
}
