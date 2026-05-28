import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";

const INITIAL_EQUITY = 10_000;
const FALLBACK_PRICE = 100;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Seed lastPrice from the most recent closed candle so a subsequent start
  // begins at a realistic price instead of the hardcoded fallback.
  let initialPrice = FALLBACK_PRICE;
  const mapping = resolveInstrument(session.instrument);
  const tf = isTimeframe(session.timeframe) ? session.timeframe : null;
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

  // Delete all trades for this session and reset fields
  const [, updated] = await prisma.$transaction([
    prisma.paperTrade.deleteMany({ where: { sessionId } }),
    prisma.paperSession.update({
      where: { id: sessionId },
      data: {
        status: "idle",
        lastPrice: initialPrice,
        equity: INITIAL_EQUITY,
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionSide: null,
        positionQty: 0,
        positionEntryPrice: null,
        positionOpenedAt: null,
        barCursor: null,
        engineState: Prisma.DbNull,
        startedAt: null,
      },
    }),
  ]);

  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
