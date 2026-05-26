/**
 * GET /api/market-data/candles
 *
 * Query historical candles from TimescaleDB.
 *
 * Query params:
 *   exchange  — e.g. 'binance'
 *   symbol    — CCXT unified, e.g. 'BTC/USDT:USDT'
 *   timeframe — e.g. '1h'
 *   from      — ISO timestamp (inclusive)
 *   to        — ISO timestamp (exclusive)
 *   limit     — max rows (default 500, max 5000)
 *
 * Returns: { candles: Candle[], count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import {
  isTimeframe,
  resolveInstrument,
} from "@/lib/market-data/types";
import type { Exchange, Timeframe } from "@/lib/market-data/types";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // ── Parse params ────────────────────────────────────────────────────────

  // Accept either a raw CCXT symbol or a QuantBlocks instrument alias
  const rawSymbol = searchParams.get("symbol");
  const rawExchange = searchParams.get("exchange");
  const instrument = searchParams.get("instrument"); // e.g. 'BTC-PERP'

  let exchange: Exchange;
  let symbol: string;

  if (instrument) {
    const mapping = resolveInstrument(instrument);
    if (!mapping) {
      return NextResponse.json(
        { error: `Unknown instrument "${instrument}"` },
        { status: 400 },
      );
    }
    exchange = mapping.exchange;
    symbol = mapping.symbol;
  } else {
    if (!rawExchange || !rawSymbol) {
      return NextResponse.json(
        {
          error:
            "Provide either ?instrument=BTC-PERP or both ?exchange=binance&symbol=BTC/USDT:USDT",
        },
        { status: 400 },
      );
    }
    exchange = rawExchange as Exchange;
    symbol = rawSymbol;
  }

  const tfRaw = searchParams.get("timeframe") ?? "1h";
  if (!isTimeframe(tfRaw)) {
    return NextResponse.json(
      { error: `Invalid timeframe "${tfRaw}"` },
      { status: 400 },
    );
  }
  const timeframe: Timeframe = tfRaw;

  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const startTime = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 90 * 24 * 3600 * 1_000);
  const endTime = toRaw ? new Date(toRaw) : new Date();

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    return NextResponse.json(
      { error: "Invalid from/to date" },
      { status: 400 },
    );
  }

  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  if (Number.isNaN(limit)) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }

  // ── Query ────────────────────────────────────────────────────────────────

  try {
    const repo = getTimescaleRepo();
    const candles = await repo.queryCandles({
      exchange,
      symbol,
      timeframe,
      startTime,
      endTime,
      limit,
    });

    return NextResponse.json({ candles, count: candles.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    console.error("[market-data/candles] Query error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
