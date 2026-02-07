"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const POLL_INTERVAL_MS = 1500;

type RunStatus = "idle" | "running" | "success" | "error";

type BacktestRun = {
  id: string;
  status: string;
  metrics?: Record<string, unknown> | null;
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

export function BacktestPanel({
  strategyId,
  disableRun = false,
}: {
  strategyId: string;
  disableRun?: boolean;
}) {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

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

  const fetchTrades = useCallback(async (rid: string) => {
    const res = await fetch(`/api/backtests/${rid}/trades`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && mountedRef.current) setTrades(data as Trade[]);
  }, [mountedRef]);
  
  const pollRun = useCallback(
    async (rid: string) => {
      const res = await fetch(`/api/backtests/${rid}`);
      if (!res.ok || !mountedRef.current) return;
      const run = (await res.json()) as BacktestRun;
      const isDone = run.status === "finished" || run.status === "completed" || run.status === "success";
      const isFail = run.status === "error" || run.status === "failed";
      if (isDone) {
        stopPolling();
        if (mountedRef.current) {
          setMetrics(run.metrics ?? null);
          setStatus("success");
          await fetchTrades(rid);
        }
        return;
      }
      if (isFail) {
        stopPolling();
        if (mountedRef.current) {
          const log = run as BacktestRun & { log?: { error?: string } };
          const errMsg =
            typeof log.log === "object" && log.log && "error" in log.log
              ? String((log.log as { error?: string }).error)
              : "Backtest failed";
          setError(errMsg);
          setStatus("error");
        }
      }
    },
    [stopPolling, fetchTrades]
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
    setTrades([]);
    setStatus("running");

    try {
      const res = await fetch(`/api/strategies/${strategyId}/backtests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as BacktestRun & { error?: string; details?: unknown };

      if (!mountedRef.current) return;

      if (!res.ok) {
        const message =
          data.error ??
          (Array.isArray(data.details)
            ? (data.details as { message?: string }[]).map((d) => d.message).join("; ")
            : `Request failed (${res.status})`);
        setError(String(message));
        setStatus("error");
        return;
      }

      const run = data as BacktestRun;
      const rid = (data as any).runId ?? (data as any).id;
      if (!rid) {
        setError("No run id in response");
        setStatus("error");
        return;
      }

      setRunId(rid);

      if (run.status === "completed" && run.metrics != null) {
        setMetrics(run.metrics);
        setStatus("success");
        await fetchTrades(rid);
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

  return (
    <div className="flex shrink-0 flex-col border-t border-gray-800 bg-gray-900/60">
      <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          Backtest
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {status === "idle" && "Idle"}
            {status === "running" && "Running…"}
            {status === "success" && "Completed"}
            {status === "error" && "Error"}
          </span>
          <button
            type="button"
            onClick={handleRunBacktest}
            disabled={status === "running" || disableRun}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run Backtest
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="max-h-64 overflow-auto p-4">
        {status === "success" && metrics != null && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Metrics
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              {Object.entries(metrics).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-gray-500">{key}</dt>
                  <dd className="text-gray-200">
                    {typeof value === "number"
                      ? Number.isFinite(value)
                        ? (value as number).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })
                        : String(value)
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {status === "success" && trades.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-500">
              Trades ({trades.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500">
                    <th className="pb-1 pr-2">Side</th>
                    <th className="pb-1 pr-2">Entry time</th>
                    <th className="pb-1 pr-2">Entry price</th>
                    <th className="pb-1 pr-2">Exit time</th>
                    <th className="pb-1 pr-2">Exit price</th>
                    <th className="pb-1 pr-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={t.id ?? i} className="border-b border-gray-800">
                      <td className="py-1 pr-2 text-gray-300">{t.side}</td>
                      <td className="py-1 pr-2 text-gray-400">
                        {formatTime(t.entryTime)}
                      </td>
                      <td className="py-1 pr-2 text-gray-300">
                        {typeof t.entryPrice === "number"
                          ? t.entryPrice.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })
                          : t.entryPrice}
                      </td>
                      <td className="py-1 pr-2 text-gray-400">
                        {formatTime(t.exitTime)}
                      </td>
                      <td className="py-1 pr-2 text-gray-300">
                        {t.exitPrice != null
                          ? typeof t.exitPrice === "number"
                            ? t.exitPrice.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })
                            : String(t.exitPrice)
                          : "—"}
                      </td>
                      <td className="py-1 text-right text-gray-300">
                        {typeof t.pnl === "number"
                          ? t.pnl.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })
                          : t.pnl}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status === "success" && trades.length === 0 && metrics != null && (
          <p className="text-sm text-gray-500">No trades in this run.</p>
        )}

        {status === "idle" && !error && (
          <p className="text-sm text-gray-500">
            Run a backtest against the saved strategy graph.
          </p>
        )}
      </div>
    </div>
  );
}
