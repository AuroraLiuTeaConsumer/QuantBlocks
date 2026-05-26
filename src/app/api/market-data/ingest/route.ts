/**
 * POST /api/market-data/ingest
 *
 * Trigger a historical data backfill from the browser or another service.
 * Useful during development and for ad-hoc gap-filling without SSH access.
 *
 * For production bulk backfills prefer the CLI job:
 *   npm run ingest -- --days 365
 *   npm run ingest -- --dataType funding_rate
 *   npm run ingest -- --dataType open_interest
 *
 * Request body (JSON):
 *   {
 *     instrument?: string;   // e.g. 'BTC-PERP'  (resolves exchange + symbol)
 *     exchange?:   string;   // e.g. 'binance'   (used when instrument absent)
 *     symbol?:     string;   // CCXT unified     (used when instrument absent)
 *     timeframe?:  string;   // default '1h'
 *     days?:       number;   // default 90
 *     dataType?:   string;   // 'candle' (default) | 'funding_rate' | 'open_interest'
 *   }
 *
 * Returns: { jobId, rowsInserted, gapsFilled, durationMs }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HistoricalDataIngestionService } from "@/lib/market-data/ingestion/historical-service";
import { FundingRateIngestionService } from "@/lib/market-data/ingestion/funding-rate-service";
import { OpenInterestIngestionService } from "@/lib/market-data/ingestion/open-interest-service";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Exchange, Timeframe } from "@/lib/market-data/types";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body — use defaults
  }

  // ── Resolve exchange + symbol ─────────────────────────────────────────────

  let exchange: Exchange;
  let symbol: string;

  if (body.instrument) {
    const mapping = resolveInstrument(body.instrument as string);
    if (!mapping) {
      return NextResponse.json(
        { error: `Unknown instrument "${body.instrument}"` },
        { status: 400 },
      );
    }
    exchange = mapping.exchange;
    symbol = mapping.symbol;
  } else {
    exchange = (body.exchange as Exchange) ?? "binance";
    symbol = (body.symbol as string) ?? "BTC/USDT:USDT";
  }

  const tfRaw = (body.timeframe as string) ?? "1h";
  if (!isTimeframe(tfRaw)) {
    return NextResponse.json(
      { error: `Invalid timeframe "${tfRaw}"` },
      { status: 400 },
    );
  }
  const timeframe: Timeframe = tfRaw;

  const daysRaw = typeof body.days === "number" ? body.days : 90;
  if (!Number.isFinite(daysRaw) || daysRaw < 1 || Math.floor(daysRaw) !== daysRaw) {
    return NextResponse.json(
      { error: "days must be a positive integer (1–365)" },
      { status: 400 },
    );
  }
  const days = Math.min(daysRaw, 365);
  const dataType = (body.dataType as string) ?? "candle";

  if (!["candle", "funding_rate", "open_interest"].includes(dataType)) {
    return NextResponse.json(
      { error: `Invalid dataType "${dataType}". Must be candle | funding_rate | open_interest` },
      { status: 400 },
    );
  }

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 3600 * 1_000);

  // ── Create job record ─────────────────────────────────────────────────────

  const job = await prisma.ingestionJob.create({
    data: {
      exchange,
      symbol,
      timeframe,
      dataType,
      startTime,
      endTime,
      status: "running",
      startedAt: new Date(),
    },
  });

  // ── Run ingestion ─────────────────────────────────────────────────────────

  try {
    let result: { rowsInserted: number; gapsFilled: number; durationMs: number };

    if (dataType === "funding_rate") {
      const service = new FundingRateIngestionService();
      result = await service.ingest({ exchange, symbol, startTime, endTime });
    } else if (dataType === "open_interest") {
      const service = new OpenInterestIngestionService();
      result = await service.ingest({ exchange, symbol, timeframe, startTime, endTime });
    } else {
      const service = new HistoricalDataIngestionService();
      result = await service.ingest({ exchange, symbol, timeframe, startTime, endTime });
    }

    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        rowsInserted: result.rowsInserted,
        completedAt: new Date(),
        meta: { gapsFilled: result.gapsFilled, durationMs: result.durationMs },
      },
    });

    return NextResponse.json({
      jobId: job.id,
      rowsInserted: result.rowsInserted,
      gapsFilled: result.gapsFilled,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
