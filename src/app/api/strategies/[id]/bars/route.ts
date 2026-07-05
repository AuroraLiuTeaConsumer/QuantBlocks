import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe, TIMEFRAMES, TIMEFRAME_MS } from "@/lib/market-data/types";
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

/** Preserve the requested date range while bounding chart payload size. */
function aggregateBars(bars: BarItem[], limit: number): BarItem[] {
  if (bars.length <= limit) return bars;

  const bucketSize = Math.ceil(bars.length / limit);
  const aggregated: BarItem[] = [];

  for (let start = 0; start < bars.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, bars.length);
    const first = bars[start];
    const last = bars[end - 1];
    let high = first.high;
    let low = first.low;
    let volume = 0;

    for (let i = start; i < end; i++) {
      high = Math.max(high, bars[i].high);
      low = Math.min(low, bars[i].low);
      volume += bars[i].volume ?? 0;
    }

    aggregated.push({
      time: first.time,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  // Keep the displayed extent equal to the actual run extent. The final bucket
  // represents the tail of the run, so plotting it at the final candle time is
  // more useful than ending the axis at the bucket's first candle.
  aggregated[aggregated.length - 1].time = bars[bars.length - 1].time;
  return aggregated;
}

/** Build calendar-aligned OHLC bars from a genuinely finer stored series. */
function resampleBars(bars: BarItem[], timeframeMs: number): BarItem[] {
  const buckets = new Map<number, BarItem>();

  for (const bar of bars) {
    const bucketTime = Math.floor((bar.time * 1_000) / timeframeMs) * timeframeMs / 1_000;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, { ...bar, time: bucketTime });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume = (current.volume ?? 0) + (bar.volume ?? 0);
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /api/strategies/:id/bars?timeframe=<string>&limit=<number>
 *
 * Returns BarItem[] (time in UTC seconds) for the strategy's instrument.
 *
 * Data priority:
 *   1. Exact TimescaleDB candles for the requested interval
 *   2. Calendar-aligned resampling from an available finer real series
 *   3. Synthetic random-walk bars for unanchored requests only
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
  const forceResample = searchParams.get("resample") === "true";
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
  const hasExplicitAnchor = endParamDate != null && !Number.isNaN(endParamDate.getTime());
  const anchorEnd = hasExplicitAnchor ? endParamDate : new Date();
  const startParam = searchParams.get("start");
  const startParamDate = startParam ? new Date(startParam) : null;
  const hasExplicitStart = startParamDate != null && !Number.isNaN(startParamDate.getTime());

  // ── Attempt real data from TimescaleDB ───────────────────────────────────

  const mapping = resolveInstrument(strategy.instrument);
  const tf = isTimeframe(timeframeParam) ? (timeframeParam as Timeframe) : null;

  if (mapping && tf) {
    try {
      const repo = getTimescaleRepo();
      const endTime = anchorEnd;
      const timeframeMs = TIMEFRAME_MS[tf];

      // queryCandles returns rows in ascending order before applying `limit`.
      // Starting from a fixed 90-day boundary therefore returned the *oldest*
      // `limit` rows in that window, leaving a large gap before an anchored
      // paper replay. Restrict the range to the final `limit` candle slots so
      // the seed ends immediately before the replay cursor.
      const lastOpenTimeMs = Math.floor((endTime.getTime() - 1) / timeframeMs) * timeframeMs;
      const startTime = hasExplicitStart
        ? startParamDate
        : new Date(lastOpenTimeMs - (limit - 1) * timeframeMs);

      const candles = forceResample
        ? []
        : await repo.queryCandles({
            exchange: mapping.exchange,
            symbol: mapping.symbol,
            timeframe: tf,
            startTime,
            endTime,
            // A ranged backtest query must cover the entire run before chart
            // aggregation. Other callers retain the efficient database limit.
            ...(hasExplicitStart ? {} : { limit }),
          });

      if (candles.length > 0) {
        const bars = aggregateBars(candles.map((c) => ({
          time: Math.floor(c.openTime.getTime() / 1_000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })), limit);

        return NextResponse.json(bars, {
          headers: {
            "X-Data-Source": `real:${mapping.exchange}:${mapping.symbol}`,
          },
        });
      }

      // Historical ingestion is strategy-driven, so a selected display
      // interval may not have its own stored series. A finer stored series can
      // still produce the requested candles exactly; a coarser one cannot and
      // must never be split into invented prices.
      const strategyTf = isTimeframe(strategy.timeframe)
        ? strategy.timeframe
        : null;
      const finerTimeframes = TIMEFRAMES
        .filter((candidate) => TIMEFRAME_MS[candidate] < timeframeMs)
        .sort((a, b) => TIMEFRAME_MS[b] - TIMEFRAME_MS[a]);
      const sourceCandidates = [
        ...(strategyTf && TIMEFRAME_MS[strategyTf] < timeframeMs
          ? [strategyTf]
          : []),
        ...finerTimeframes,
      ].filter((candidate, index, all) => all.indexOf(candidate) === index);

      for (const sourceTimeframe of sourceCandidates) {
        const sourceCandles = await repo.queryCandles({
          exchange: mapping.exchange,
          symbol: mapping.symbol,
          timeframe: sourceTimeframe,
          startTime,
          endTime,
        });
        if (sourceCandles.length === 0) continue;

        const resampled = resampleBars(
          sourceCandles.map((c) => ({
            time: Math.floor(c.openTime.getTime() / 1_000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          timeframeMs,
        );
        if (resampled.length === 0) continue;

        return NextResponse.json(aggregateBars(resampled, limit), {
          headers: {
            "X-Data-Source": `real:${mapping.exchange}:${mapping.symbol}:resampled-${sourceTimeframe}`,
          },
        });
      }
    } catch (err) {
      // TimescaleDB not yet set up or no data — fall through to synthetic
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[bars] Real data unavailable, using synthetic: ${msg}`);
    }
  }

  // An explicit `end` is used to seed a real-data paper replay. If no real
  // candles exist before that cursor (common at the beginning of an exchange's
  // history), synthetic bars generated near Date.now() would put 2026 timestamps
  // beside 2020 replay prices and prevent older real bars from appending. Leave
  // the chart empty instead; the first replay batch will establish its timeline.
  if (hasExplicitAnchor) {
    return NextResponse.json([], {
      headers: { "X-Data-Source": "real-empty" },
    });
  }

  // ── Synthetic fallback ───────────────────────────────────────────────────

  const barSpacingSec = isTimeframe(timeframeParam)
    ? TIMEFRAME_MS[timeframeParam] / 1000
    : TIMEFRAME_MS["1h"] / 1000;

  const bars = generateSyntheticBars(barSpacingSec, limit);

  return NextResponse.json(bars, {
    headers: { "X-Data-Source": "synthetic" },
  });
}
