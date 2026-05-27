/**
 * GET  /api/market-data/liquidations  — query stored liquidation data
 * POST /api/market-data/liquidations  — trigger a CoinGlass liquidation ingest
 *
 * GET query params:
 *   symbol    — base ticker, e.g. 'BTC' (default 'BTC')
 *   timeframe — '1h' | '4h' | '1d' (default '1h')
 *   from      — ISO timestamp (inclusive), default 90 days ago
 *   to        — ISO timestamp (exclusive), default now
 *   limit     — max rows (default 500, max 5000)
 *
 * POST body (JSON):
 *   {
 *     symbol?:    string;  // e.g. 'BTC' (default 'BTC')
 *     timeframe?: string;  // '1h' | '4h' | '1d' (default '1h')
 *     days?:      number;  // window to filter (default 90, max 365)
 *   }
 *
 * Returns 503 if COINGLASS_API_KEY is not configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { LiquidationIngestionService } from "@/lib/market-data/ingestion/liquidation-service";
import { CoinGlassProvider } from "@/lib/market-data/providers/coinglass.provider";
import { isCGTimeframe } from "@/lib/market-data/types";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const symbol = searchParams.get("symbol") ?? "BTC";
  const tfRaw = searchParams.get("timeframe") ?? "1h";

  if (!isCGTimeframe(tfRaw)) {
    return NextResponse.json(
      { error: `Invalid timeframe "${tfRaw}". CoinGlass supports: 1h | 4h | 1d` },
      { status: 400 },
    );
  }

  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const startTime = fromRaw
    ? new Date(fromRaw)
    : new Date(Date.now() - 90 * 24 * 3600 * 1_000);
  const endTime = toRaw ? new Date(toRaw) : new Date();

  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
  }

  const limitRaw = searchParams.get("limit");
  const limitNum = limitRaw ? parseInt(limitRaw, 10) : DEFAULT_LIMIT;
  if (Number.isNaN(limitNum)) {
    return NextResponse.json({ error: "Invalid limit parameter" }, { status: 400 });
  }
  const limit = Math.min(Math.max(1, limitNum), MAX_LIMIT);

  try {
    const repo = getTimescaleRepo();
    const liquidations = await repo.queryLiquidations({
      symbol,
      timeframe: tfRaw,
      startTime,
      endTime,
      limit,
    });
    return NextResponse.json({ liquidations, count: liquidations.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    console.error("[market-data/liquidations] Query error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!CoinGlassProvider.isConfigured()) {
    return NextResponse.json(
      { error: "COINGLASS_API_KEY is not configured on this server" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body — use defaults
  }

  const symbol = (body.symbol as string) ?? "BTC";
  const tfRaw = (body.timeframe as string) ?? "1h";

  if (!isCGTimeframe(tfRaw)) {
    return NextResponse.json(
      { error: `Invalid timeframe "${tfRaw}". CoinGlass supports: 1h | 4h | 1d` },
      { status: 400 },
    );
  }

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
      exchange: "coinglass",
      symbol,
      timeframe: tfRaw,
      dataType: "liquidation",
      startTime,
      endTime,
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    const service = new LiquidationIngestionService();
    const result = await service.ingest({ symbol, timeframe: tfRaw, startTime, endTime });

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
