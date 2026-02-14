import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Bar spacing in seconds for each timeframe string.
 * Used to generate synthetic OHLC bars ending at now (UTC).
 */
const TIMEFRAME_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
};

const DEFAULT_TIMEFRAME = "1h";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export type BarItem = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function getBarSpacingSeconds(timeframe: string): number {
  const normalized = timeframe.toLowerCase().trim();
  return TIMEFRAME_SECONDS[normalized] ?? TIMEFRAME_SECONDS[DEFAULT_TIMEFRAME];
}

/**
 * Generate synthetic OHLC bars (random walk) for MVP stub.
 * Bars end at now (UTC seconds). High >= max(open, close), low <= min(open, close).
 */
function generateSyntheticBars(
  barSpacingSeconds: number,
  limit: number
): BarItem[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - (limit - 1) * barSpacingSeconds;

  const bars: BarItem[] = [];
  let price = 40000 + Math.random() * 10000; // start around 40k–50k

  for (let i = 0; i < limit; i++) {
    const time = startSec + i * barSpacingSeconds;
    const open = price;
    const change = (Math.random() - 0.48) * 800;
    const close = Math.max(1000, open + change);
    const high = Math.max(open, close) + Math.random() * 200;
    const low = Math.min(open, close) - Math.random() * 200;
    const volume = Math.floor(Math.random() * 100) + 10;

    bars.push({ time, open, high, low, close, volume });
    price = close;
  }

  return bars;
}

/**
 * GET /api/strategies/:id/bars?timeframe=<string>&limit=<number>
 * Returns JSON array of { time, open, high, low, close, volume? }.
 * time is Unix seconds (UTCTimestamp).
 *
 * MVP: synthetic OHLC from generateSyntheticBars().
 * To use real exchange data later: fetch OHLC from your exchange (e.g. Hyperliquid
 * or Binance) for the strategy’s instrument and timeframe, map to the same BarItem
 * shape (time in UTC seconds), and return here instead of calling generateSyntheticBars.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const timeframe = searchParams.get("timeframe") ?? strategy.timeframe ?? DEFAULT_TIMEFRAME;
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT),
    MAX_LIMIT
  );

  if (Number.isNaN(limit)) {
    return NextResponse.json(
      { error: "Invalid limit parameter" },
      { status: 400 }
    );
  }

  const barSpacingSeconds = getBarSpacingSeconds(timeframe);
  const bars = generateSyntheticBars(barSpacingSeconds, limit);

  return NextResponse.json(bars);
}
