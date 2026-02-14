"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const POLL_SESSION_MS = 1000;
const POLL_TRADES_MS = 3000;

// ── Types ────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────

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
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-gray-400";
}

// ── Stat Card ────────────────────────────────────────────────

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
    <div className="flex flex-col items-center rounded-lg bg-gray-800/60 px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span
        className={`mt-0.5 text-sm font-semibold tabular-nums ${color ?? "text-gray-200"}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

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

  const mountedRef = useRef(true);
  const sessionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (sessionPollRef.current) clearInterval(sessionPollRef.current);
      if (tradePollRef.current) clearInterval(tradePollRef.current);
    };
  }, []);

  // ── Polling ──────────────────────────────────────────────

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
        if (data.status !== "running") {
          stopPolling();
        }
      } catch {
        // Network errors are transient, keep polling
      }
    },
    [stopPolling],
  );

  const pollTrades = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/paper/${sid}/trades`);
      if (!res.ok || !mountedRef.current) return;
      const data = await res.json();
      if (Array.isArray(data) && mountedRef.current) {
        setTrades(data as PaperTrade[]);
      }
    } catch {
      // transient
    }
  }, []);

  const startPolling = useCallback(
    (sid: string) => {
      stopPolling();
      // Immediate first poll
      pollSession(sid);
      pollTrades(sid);
      sessionPollRef.current = setInterval(() => pollSession(sid), POLL_SESSION_MS);
      tradePollRef.current = setInterval(() => pollTrades(sid), POLL_TRADES_MS);
    },
    [stopPolling, pollSession, pollTrades],
  );

  // ── Actions ──────────────────────────────────────────────

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/strategies/${strategyId}/paper/start`, {
        method: "POST",
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to start");
        setLoading(false);
        return;
      }
      const snap = data as SessionSnapshot;
      setSession(snap);
      setTrades([]);
      setLoading(false);
      if (snap.status === "running") {
        startPolling(snap.id);
      }
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
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to stop");
        return;
      }
      setSession(data as SessionSnapshot);
      stopPolling();
      // Final trade fetch
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
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to reset");
        return;
      }
      setSession(data as SessionSnapshot);
      setTrades([]);
      stopPolling();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    }
  };

  // ── Status helpers ───────────────────────────────────────

  const status = session?.status ?? "idle";
  const isRunning = status === "running";
  const canStart = !isRunning && !disableRun && !loading;
  const canStop = isRunning;
  const canReset = session != null && !isRunning;

  const statusBadge = (() => {
    switch (status) {
      case "running":
        return "bg-blue-900/40 text-blue-400";
      case "stopped":
        return "bg-yellow-900/40 text-yellow-400";
      case "error":
        return "bg-red-900/40 text-red-400";
      default:
        return "bg-gray-800 text-gray-500";
    }
  })();

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="flex shrink-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge}`}
          >
            {status === "idle" && "Idle"}
            {status === "running" && "Running"}
            {status === "stopped" && "Stopped"}
            {status === "error" && "Error"}
          </span>
          {isRunning && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          )}
        </div>
        <div className="flex gap-2">
          {canReset && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              Reset
            </button>
          )}
          {canStop && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/50"
            >
              Stop
            </button>
          )}
          {!isRunning && (
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Starting…" : "Start Paper Trading"}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="max-h-[500px] overflow-y-auto">
        {/* Live Stats */}
        {session && status !== "idle" && (
          <div className="grid grid-cols-3 gap-2 border-b border-gray-800 px-4 py-3 sm:grid-cols-6">
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
                  ? "text-green-400"
                  : session.position.side === "short"
                    ? "text-red-400"
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

        {/* Trade Log */}
        {trades.length > 0 && (
          <div className="px-4 py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Trades ({trades.length})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full min-w-[550px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/40 text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Entry</th>
                    <th className="px-3 py-2 text-right">Entry $</th>
                    <th className="px-3 py-2">Exit</th>
                    <th className="px-3 py-2 text-right">Exit $</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const isLong = t.side === "long";
                    return (
                      <tr
                        key={t.id}
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
                          {formatNum(t.entryPrice, 4)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">
                          {formatTime(t.exitTime)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                          {t.exitPrice != null ? formatNum(t.exitPrice, 4) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                          {formatNum(t.qty, 4)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums font-medium ${pnlColor(t.pnl)}`}
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
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            Start paper trading to simulate live execution of this strategy.
          </p>
        )}

        {isRunning && trades.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-4 py-6">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            <span className="text-sm text-gray-400">
              Waiting for trades…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
