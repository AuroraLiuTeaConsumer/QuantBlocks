import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { createInitialState } from "@/lib/strategy/engine";
import type { Prisma } from "@prisma/client";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";

const INITIAL_EQUITY = 10_000;
const FALLBACK_PRICE = 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Optional body: { useRealBars?: boolean; replayFrom?: string (ISO date) }
  let useRealBars = false;
  let barCursor: Date | null = null;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.useRealBars === true) {
      useRealBars = true;
      if (typeof body.replayFrom === "string" && body.replayFrom) {
        const d = new Date(body.replayFrom);
        if (!isNaN(d.getTime())) barCursor = d;
      }
    }
  } catch {
    // empty / non-JSON body — use defaults
  }

  try {
    const strategy = await prisma.strategy.findUnique({ where: { id } });
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    // If there's already a running session for this strategy, either resume
    // it or reject if the caller's params conflict with its configuration.
    const existing = await prisma.paperSession.findFirst({
      where: { strategyId: id, status: "running" },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const wantsDifferentMode = useRealBars !== existing.useRealBars;
      const wantsNewReplayDate = barCursor !== null;
      if (wantsDifferentMode || wantsNewReplayDate) {
        return NextResponse.json(
          {
            error:
              "A session is already running with different settings. " +
              "Stop the current session before changing real-bar mode or replay date.",
            sessionId: existing.id,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(toSnapshot(existing as unknown as SessionRow));
    }

    // Seed lastPrice from the most recent closed candle so the initial price
    // display and synthetic random-walk start at a realistic level.
    let initialPrice = FALLBACK_PRICE;
    const mapping = resolveInstrument(strategy.instrument);
    const tf = isTimeframe(strategy.timeframe) ? strategy.timeframe : null;
    if (mapping && tf) {
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
        useRealBars,
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
