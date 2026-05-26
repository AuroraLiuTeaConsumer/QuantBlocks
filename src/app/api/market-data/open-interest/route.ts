/**
 * GET /api/market-data/open-interest
 *
 * Query historical open interest snapshots from TimescaleDB.
 *
 * Query params:
 *   instrument?  — e.g. 'BTC-PERP'
 *   exchange?    — e.g. 'binance'
 *   symbol?      — CCXT unified
 *   timeframe?   — snapshot granularity (default '1h')
 *   from?        — ISO start time (default: 30 days ago)
 *   to?          — ISO end time   (default: now)
 *   limit?       — max rows (default 500, max 5000)
 *
 * POST /api/market-data/open-interest
 *
 * Trigger an open interest ingestion job.
 * Body: { instrument?, exchange?, symbol?, timeframe?, days? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { OpenInterestIngestionService } from "@/lib/market-data/ingestion/open-interest-service";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Exchange, Timeframe } from "@/lib/market-data/types";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let exchange: string;
  let symbol: string;

  const instrument = searchParams.get("instrument");
  if (instrument) {
    const mapping = resolveInstrument(instrument);
    if (!mapping) {
      return NextResponse.json({ error: `Unknown instrument "${instrument}"` }, { status: 400 });
    }
    exchange = mapping.exchange;
    symbol = mapping.symbol;
  } else {
    exchange = searchParams.get("exchange") ?? "binance";
    symbol = searchParams.get("symbol") ?? "BTC/USDT:USDT";
  }

  const tfRaw = searchParams.get("timeframe") ?? "1h";
  if (!isTimeframe(tfRaw)) {
    return NextResponse.json({ error: `Invalid timeframe "${tfRaw}"` }, { status: 400 });
  }

  const now = new Date();
  const toTime = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const fromTime = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(toTime.getTime() - 30 * 24 * 3_600_000);

  if (isNaN(toTime.getTime()) || isNaN(fromTime.getTime())) {
    return NextResponse.json({ error: "Invalid date parameter" }, { status: 400 });
  }

  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  if (Number.isNaN(limit)) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }

  try {
    const repo = getTimescaleRepo();
    const rows = await repo.queryOpenInterest({
      exchange: exchange as Exchange,
      symbol,
      timeframe: tfRaw as Timeframe,
      startTime: fromTime,
      endTime: toTime,
      limit,
    });

    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }

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
    return NextResponse.json({ error: `Invalid timeframe "${tfRaw}"` }, { status: 400 });
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
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 3600 * 1_000);

  const job = await prisma.ingestionJob.create({
    data: {
      exchange,
      symbol,
      timeframe,
      dataType: "open_interest",
      startTime,
      endTime,
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const service = new OpenInterestIngestionService();
    const result = await service.ingest({ exchange, symbol, timeframe, startTime, endTime });

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
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
