import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateGraph } from "@/lib/strategy/validator";
import { runBacktest, DEFAULT_CONFIG } from "@/lib/backtest/backtest";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import {
  getBacktestDataLoader,
  InsufficientDataError,
} from "@/lib/backtest/data-loader";
import { HistoricalDataIngestionService } from "@/lib/market-data/ingestion/historical-service";
import {
  resolveInstrument,
  isTimeframe,
  TIMEFRAME_MS,
} from "@/lib/market-data/types";
import type { QualityReport } from "@/lib/market-data/types";
import { checkCandleQuality } from "@/lib/market-data/ingestion/quality-checker";
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

  // ── Resolve instrument ──────────────────────────────────────────────────

  const mapping = resolveInstrument(strategy.instrument);
  const tf = isTimeframe(strategy.timeframe) ? strategy.timeframe : null;

  if (!mapping || !tf) {
    return NextResponse.json(
      {
        error: `Cannot resolve instrument "${strategy.instrument}" or timeframe "${strategy.timeframe}". Update the strategy settings.`,
      },
      { status: 422 },
    );
  }

  const endTime = bodyEndTime ?? new Date();
  const startTime = bodyStartTime ?? new Date(endTime.getTime() - 90 * 24 * 3600 * 1_000);
  const timeframeMs = TIMEFRAME_MS[tf];

  // ── Load candles — auto-ingest the window if coverage is insufficient ────

  let candles: BacktestCandle[];
  let dataSourceLabel: string;
  let fundingRates: FundingRate[] = [];
  let dataQuality: QualityReport | undefined;

  try {
    const loader = getBacktestDataLoader();
    let dataset: Awaited<ReturnType<typeof loader.load>>;
    let autoIngested = false;

    try {
      dataset = await loader.load({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        timeframe: tf,
        startTime,
        endTime,
      });
      // Quality check on cached data so the report is always populated
      const { report } = checkCandleQuality(
        dataset.candles.map((c) => ({ ...c, openTime: new Date(c.time) })),
      );
      dataQuality = report;
    } catch (loadErr) {
      if (!(loadErr instanceof InsufficientDataError)) throw loadErr;

      // Coverage insufficient — fetch missing candles from exchange then retry
      console.log(
        `[backtest] ${loadErr.coveragePct.toFixed(1)}% coverage for ` +
          `${mapping.exchange} ${mapping.symbol} ${tf} — auto-ingesting…`,
      );
      const ingestService = new HistoricalDataIngestionService();
      const ingestResult = await ingestService.ingest(
        { exchange: mapping.exchange, symbol: mapping.symbol, timeframe: tf, startTime, endTime },
        (msg) => console.log(`[backtest ingest] ${msg}`),
      );
      autoIngested = true;
      dataQuality = ingestResult.quality;

      // One retry after ingest
      dataset = await loader.load({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        timeframe: tf,
        startTime,
        endTime,
      });
    }

    candles = dataset.candles;
    dataSourceLabel =
      `${mapping.exchange} ${mapping.symbol} ${tf} ` +
      `(${dataset.candleCount} bars, ${dataset.coveragePct.toFixed(1)}% coverage` +
      `${autoIngested ? ", auto-ingested" : ""})`;

    // Funding rates — best-effort, proceed without if unavailable
    try {
      const repo = getTimescaleRepo();
      fundingRates = await repo.queryFundingRates({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        startTime,
        endTime,
      });
    } catch {
      /* optional */
    }
  } catch (err) {
    const message =
      err instanceof InsufficientDataError
        ? `Not enough data after auto-ingest: ${err.coveragePct.toFixed(1)}% coverage ` +
          `(${err.found}/${err.expected} candles). ` +
          `The exchange may not have data for this period — try a different date range.`
        : `Failed to load market data: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json({ error: message }, { status: 422 });
  }

  // ── Determine time range for the run record ─────────────────────────────

  const runStartTime = candles[0].time;
  const runEndTime = candles[candles.length - 1].time;

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
            dataSource: "real",
            dataSourceLabel,
            fundingRatesLoaded: fundingRates.length,
            dataQuality: dataQuality ?? null,
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
