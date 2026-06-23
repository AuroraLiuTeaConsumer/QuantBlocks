import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { createInitialState } from "@/lib/strategy/engine";
import type { Prisma } from "@prisma/client";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { getBacktestDataLoader, InsufficientDataError } from "@/lib/backtest/data-loader";
import { HistoricalDataIngestionService } from "@/lib/market-data/ingestion/historical-service";

const INITIAL_EQUITY = 10_000;
const FALLBACK_PRICE = 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Optional body: { replayFrom?: string (ISO date) }
  let barCursor: Date | null = null;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.replayFrom === "string" && body.replayFrom) {
      const d = new Date(body.replayFrom);
      if (!isNaN(d.getTime())) barCursor = d;
    }
  } catch {
    // empty / non-JSON body — use defaults
  }

  try {
    const strategy = await prisma.strategy.findUnique({ where: { id } });
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    // If there's already a running session, return it — unless the caller
    // wants a different replay date, which requires stopping first.
    const existing = await prisma.paperSession.findFirst({
      where: { strategyId: id, status: "running" },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      if (barCursor !== null) {
        return NextResponse.json(
          {
            error:
              "A session is already running. Stop it before changing the replay date.",
            sessionId: existing.id,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(toSnapshot(existing as unknown as SessionRow));
    }

    let initialPrice = FALLBACK_PRICE;
    const mapping = resolveInstrument(strategy.instrument);
    const tf = isTimeframe(strategy.timeframe) ? strategy.timeframe : null;

    if (!mapping || !tf) {
      return NextResponse.json(
        { error: `Cannot resolve instrument "${strategy.instrument}" or timeframe "${strategy.timeframe}". Update the strategy settings.` },
        { status: 422 },
      );
    }

    // ── Ensure data exists for the replay window — auto-ingest if needed ────
    const windowEnd = new Date();
    const windowStart = barCursor ?? new Date(windowEnd.getTime() - 90 * 24 * 3600 * 1_000);
    // Persist the resolved replay start so the snapshot's barCursor always
    // reflects where playback actually begins (not just explicit replayFrom).
    // The chart seed endpoint relies on this to avoid seeding bars that are
    // newer than the first bar the replay will append.
    barCursor = windowStart;
    const loader = getBacktestDataLoader();

    try {
      await loader.load({ exchange: mapping.exchange, symbol: mapping.symbol, timeframe: tf as Timeframe, startTime: windowStart, endTime: windowEnd });
    } catch (loadErr) {
      if (!(loadErr instanceof InsufficientDataError)) {
        const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        return NextResponse.json({ error: `Failed to verify market data: ${msg}` }, { status: 422 });
      }
      console.log(`[paper/start] ${loadErr.coveragePct.toFixed(1)}% coverage for ${mapping.exchange} ${mapping.symbol} ${tf} — auto-ingesting…`);
      try {
        const ingestService = new HistoricalDataIngestionService();
        await ingestService.ingest(
          { exchange: mapping.exchange, symbol: mapping.symbol, timeframe: tf as Timeframe, startTime: windowStart, endTime: windowEnd },
          (msg) => console.log(`[paper ingest] ${msg}`),
        );
        await loader.load({ exchange: mapping.exchange, symbol: mapping.symbol, timeframe: tf as Timeframe, startTime: windowStart, endTime: windowEnd });
      } catch (retryErr) {
        const message =
          retryErr instanceof InsufficientDataError
            ? `Not enough data after auto-ingest: ${retryErr.coveragePct.toFixed(1)}% coverage. Try a different replay date.`
            : `Auto-ingestion failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`;
        return NextResponse.json({ error: message }, { status: 422 });
      }
    }

    // ── Seed lastPrice from the most recent closed candle ───────────────────
    try {
      const repo = getTimescaleRepo();
      const latestTime = await repo.getLatestOpenTime(mapping.exchange, mapping.symbol, tf as Timeframe);
      if (latestTime) {
        const candles = await repo.queryCandles({
          exchange: mapping.exchange,
          symbol: mapping.symbol,
          timeframe: tf as Timeframe,
          startTime: latestTime,
          endTime: new Date(latestTime.getTime() + 1),
          limit: 1,
        });
        if (candles.length > 0) initialPrice = candles[0].close;
      }
    } catch {
      // TimescaleDB unavailable — proceed with fallback
    }

    const engineState = createInitialState(INITIAL_EQUITY);

    const session = await prisma.paperSession.create({
      data: {
        strategyId: id,
        status: "running",
        instrument: strategy.instrument,
        timeframe: strategy.timeframe,
        lastPrice: initialPrice,
        equity: INITIAL_EQUITY,
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionSide: null,
        positionQty: 0,
        positionEntryPrice: null,
        useRealBars: true,
        barCursor,
        engineState: JSON.parse(JSON.stringify(engineState)) as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    console.error("[paper/start] Prisma error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
