import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateGraph } from "@/lib/strategy/validator";
import { runBacktest, DEFAULT_CONFIG } from "@/lib/backtest/backtest";
import { SAMPLE_CANDLES } from "@/lib/data/candles";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import {
  getBacktestDataLoader,
  InsufficientDataError,
} from "@/lib/backtest/data-loader";
import {
  resolveInstrument,
  isTimeframe,
  TIMEFRAME_MS,
} from "@/lib/market-data/types";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import type { Candle as BacktestCandle } from "@/lib/backtest/backtest";
import type { FundingRate } from "@/lib/market-data/types";

// POST /api/strategies/:id/backtests — run a backtest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const graph: StrategyGraph = {
    nodes: strategy.nodes as StrategyGraph["nodes"],
    edges: strategy.edges as StrategyGraph["edges"],
  };

  const validation = validateGraph(graph);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Invalid strategy graph", details: validation.errors },
      { status: 400 },
    );
  }

  // ── Parse request body ──────────────────────────────────────────────────

  let config = DEFAULT_CONFIG;
  let bodyStartTime: Date | null = null;
  let bodyEndTime: Date | null = null;

  try {
    const body = await req.json();
    if (body.initialCapital) config = { ...config, initialCapital: body.initialCapital };
    if (body.feeBps != null) config = { ...config, feeBps: body.feeBps };
    if (body.startTime) bodyStartTime = new Date(body.startTime);
    if (body.endTime) bodyEndTime = new Date(body.endTime);
  } catch {
    // No body / invalid JSON — use defaults
  }

  // ── Resolve candle data source ──────────────────────────────────────────
  // Priority: TimescaleDB real data → SAMPLE_CANDLES fallback.
  // The strategy's instrument and timeframe drive the TimescaleDB query.

  let candles: BacktestCandle[] = SAMPLE_CANDLES;
  let dataSource: "real" | "sample" = "sample";
  let dataSourceLabel = "Sample (synthetic 60-bar dataset)";
  let fundingRates: FundingRate[] = [];
  let timeframeMs: number | undefined;

  const mapping = resolveInstrument(strategy.instrument);
  const tf = isTimeframe(strategy.timeframe) ? strategy.timeframe : null;

  if (mapping && tf) {
    const endTime = bodyEndTime ?? new Date();
    const startTime = bodyStartTime ?? new Date(endTime.getTime() - 90 * 24 * 3600 * 1_000);
    timeframeMs = TIMEFRAME_MS[tf];

    try {
      const loader = getBacktestDataLoader();
      const dataset = await loader.load({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        timeframe: tf,
        startTime,
        endTime,
      });

      candles = dataset.candles;
      dataSource = "real";
      dataSourceLabel =
        `${mapping.exchange} ${mapping.symbol} ${tf} ` +
        `(${dataset.candleCount} bars, ${dataset.coveragePct.toFixed(1)}% coverage)`;

      // Load funding rates for the same window (best-effort — silently skip if unavailable)
      try {
        const repo = getTimescaleRepo();
        fundingRates = await repo.queryFundingRates({
          exchange: mapping.exchange,
          symbol: mapping.symbol,
          startTime,
          endTime,
        });
      } catch {
        // Funding rates are optional; proceed without them
      }
    } catch (err) {
      if (err instanceof InsufficientDataError) {
        // Not enough real data — fall back gracefully with a clear log message
        console.warn(
          `[backtest] Insufficient data for ${mapping.exchange} ${mapping.symbol}: ` +
            `${err.coveragePct.toFixed(1)}% coverage. Falling back to sample data.`,
        );
      } else {
        // Unexpected error (DB unreachable, etc.) — fall back, don't crash
        console.error("[backtest] Data loader error:", err);
      }
      // candles stays as SAMPLE_CANDLES
    }
  }

  // ── Determine time range for the run record ─────────────────────────────

  const runStartTime =
    candles.length > 0 ? candles[0].time : SAMPLE_CANDLES[0].time;
  const runEndTime =
    candles.length > 0
      ? candles[candles.length - 1].time
      : SAMPLE_CANDLES[SAMPLE_CANDLES.length - 1].time;

  // ── Create run record ───────────────────────────────────────────────────

  const run = await prisma.backtestRun.create({
    data: {
      strategyId: id,
      mode: "backtest",
      status: "running",
      startTime: runStartTime,
      endTime: runEndTime,
    },
  });

  try {
    // Run backtest (synchronous — fine for MVP dataset sizes)
    const result = runBacktest(graph, candles, { ...config, fundingRates, timeframeMs });

    // Persist trades
    for (const t of result.trades) {
      await prisma.trade.create({
        data: {
          runId: run.id,
          side: t.side,
          entryTime: t.entryTime,
          entryPrice: t.entryPrice,
          exitTime: t.exitTime,
          exitPrice: t.exitPrice,
          qty: t.qty,
          pnl: t.pnl,
          reasonOpen: t.reasonOpen,
          reasonClose: t.reasonClose ?? "N/A",
        },
      });
    }

    const updated = await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        metrics: JSON.parse(JSON.stringify(result.metrics)),
        log: JSON.parse(
          JSON.stringify({
            debugEvents: result.debugEvents,
            equityCurve: result.equityCurve,
            initialCapital: config.initialCapital,
            // Data source metadata — consumed by BacktestPanel
            dataSource,
            dataSourceLabel,
            fundingRatesLoaded: fundingRates.length,
          }),
        ),
      },
    });

    return NextResponse.json(updated, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        log: JSON.parse(JSON.stringify({ error: message })),
      },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
