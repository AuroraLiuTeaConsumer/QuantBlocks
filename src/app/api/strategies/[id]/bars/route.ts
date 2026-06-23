import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";

const DEFAULT_TIMEFRAME = "1h";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;

// Bar shape expected by TwoPaneChart / lightweight-charts
export type BarItem = {
  time: number; // UTC seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

// ─── Synthetic fallback ───────────────────────────────────────────────────────

const TIMEFRAME_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

function generateSyntheticBars(barSpacingSec: number, limit: number): BarItem[] {
  const nowSec = Math.floor(Date.now() / 1_000);
  const startSec = nowSec - (limit - 1) * barSpacingSec;

  const bars: BarItem[] = [];
  let price = 40_000 + Math.random() * 10_000;

  for (let i = 0; i < limit; i++) {
    const open = price;
    const change = (Math.random() - 0.48) * 800;
    const close = Math.max(1_000, open + change);
    bars.push({
      time: startSec + i * barSpacingSec,
      open,
      high: Math.max(open, close) + Math.random() * 200,
      low: Math.min(open, close) - Math.random() * 200,
      close,
      volume: Math.floor(Math.random() * 100) + 10,
    });
    price = close;
  }

  return bars;
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /api/strategies/:id/bars?timeframe=<string>&limit=<number>
 *
 * Returns BarItem[] (time in UTC seconds) for the strategy's instrument.
 *
 * Data priority:
 *   1. TimescaleDB real candles (when data has been ingested for this instrument)
 *   2. Synthetic random-walk bars (fallback — always works, clearly labelled)
 *
 * The X-Data-Source response header tells the client which source was used.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const timeframeParam =
    searchParams.get("timeframe") ?? strategy.timeframe ?? DEFAULT_TIMEFRAME;
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  if (Number.isNaN(limit)) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }

  // `end` lets callers anchor the window to a point other than "now" — e.g.
  // a paper session seeding chart context ending at its replay start, so the
  // seeded bars never sit later in time than the first bar the replay appends.
  const endParam = searchParams.get("end");
  const endParamDate = endParam ? new Date(endParam) : null;
  const anchorEnd = endParamDate && !Number.isNaN(endParamDate.getTime()) ? endParamDate : new Date();

  // ── Attempt real data from TimescaleDB ───────────────────────────────────

  const mapping = resolveInstrument(strategy.instrument);
  const tf = isTimeframe(timeframeParam) ? (timeframeParam as Timeframe) : null;

  if (mapping && tf) {
    try {
      const repo = getTimescaleRepo();
      const endTime = anchorEnd;
      const startTime = new Date(endTime.getTime() - 90 * 24 * 3_600 * 1_000);

      const candles = await repo.queryCandles({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        timeframe: tf,
        startTime,
        endTime,
        limit,
      });

      if (candles.length > 0) {
        const bars: BarItem[] = candles.map((c) => ({
          time: Math.floor(c.openTime.getTime() / 1_000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        return NextResponse.json(bars, {
          headers: {
            "X-Data-Source": `real:${mapping.exchange}:${mapping.symbol}`,
          },
        });
      }
    } catch (err) {
      // TimescaleDB not yet set up or no data — fall through to synthetic
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[bars] Real data unavailable, using synthetic: ${msg}`);
    }
  }

  // ── Synthetic fallback ───────────────────────────────────────────────────

  const barSpacingSec =
    TIMEFRAME_SECONDS[timeframeParam.toLowerCase()] ??
    TIMEFRAME_SECONDS[DEFAULT_TIMEFRAME];

  const bars = generateSyntheticBars(barSpacingSec, limit);

  return NextResponse.json(bars, {
    headers: { "X-Data-Source": "synthetic" },
  });
}
