/**
 * GET /api/backtests/:runId/export
 *
 * Download a completed backtest run as a CSV file.
 *
 * The CSV contains three sections:
 *   # METRICS    — key/value pairs
 *   # TRADES     — one row per closed trade
 *   # EQUITY_CURVE — per-bar equity snapshots
 *
 * Query params:
 *   (none for now — format=csv is the only option)
 *
 * Returns 404 for unknown runs, 400 for runs that are not yet completed.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const run = await prisma.backtestRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Backtest run not found" }, { status: 404 });
  }
  if (run.status !== "completed") {
    return NextResponse.json(
      { error: `Run is not completed (status: ${run.status})` },
      { status: 400 },
    );
  }

  const trades = await prisma.trade.findMany({
    where: { runId },
    orderBy: { entryTime: "asc" },
  });

  const log = run.log as Record<string, unknown> | null;
  const equityCurve = Array.isArray(log?.equityCurve)
    ? (log.equityCurve as { time: string; equity: number }[])
    : [];
  const metrics = (run.metrics ?? {}) as Record<string, unknown>;

  // ── Build CSV ──────────────────────────────────────────────────────────────

  const lines: string[] = [];

  // Metadata header
  lines.push(`# QuantBlocks Backtest Export`);
  lines.push(`# Run ID: ${runId}`);
  if (run.startTime) lines.push(`# Period start: ${run.startTime}`);
  if (run.endTime) lines.push(`# Period end: ${run.endTime}`);
  if (log?.dataSourceLabel) lines.push(`# Data source: ${log.dataSourceLabel}`);
  lines.push("");

  // Metrics section
  lines.push("# METRICS");
  lines.push("Metric,Value");
  const metricLabels: Record<string, string> = {
    totalReturnPct: "Total Return %",
    netPnl: "Net PnL",
    maxDrawdownPct: "Max Drawdown %",
    winRate: "Win Rate",
    numberOfTrades: "Number of Trades",
    avgWin: "Avg Win",
    avgLoss: "Avg Loss",
    profitFactor: "Profit Factor",
    sharpe: "Sharpe Ratio",
    sortino: "Sortino Ratio",
    calmar: "Calmar Ratio",
    benchmarkReturnPct: "Benchmark Return %",
    fundingCostPaid: "Funding Cost Paid",
  };
  for (const [key, label] of Object.entries(metricLabels)) {
    if (key in metrics) lines.push(`${label},${metrics[key] ?? "N/A"}`);
  }
  lines.push("");

  // Trades section
  lines.push("# TRADES");
  lines.push("Side,Entry Time,Entry Price,Exit Time,Exit Price,Qty,PnL,Reason Open,Reason Close");
  for (const t of trades) {
    const reasonOpen = String(t.reasonOpen ?? "").replace(/"/g, '""');
    const reasonClose = String(t.reasonClose ?? "").replace(/"/g, '""');
    lines.push(
      [
        t.side,
        t.entryTime ?? "",
        t.entryPrice,
        t.exitTime ?? "",
        t.exitPrice ?? "",
        t.qty,
        t.pnl,
        `"${reasonOpen}"`,
        `"${reasonClose}"`,
      ].join(","),
    );
  }
  lines.push("");

  // Equity curve section
  lines.push("# EQUITY_CURVE");
  lines.push("Time,Equity");
  for (const pt of equityCurve) {
    lines.push(`${pt.time},${pt.equity}`);
  }

  const csv = lines.join("\n");
  const filename = `backtest-${runId.slice(0, 8)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
