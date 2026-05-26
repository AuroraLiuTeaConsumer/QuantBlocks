/**
 * GET /api/market-data/coverage
 *
 * Returns a snapshot of all data stored in TimescaleDB:
 *   - candles: per (exchange, symbol, timeframe) series — bar count + date range
 *   - fundingRates: per (exchange, symbol) — event count + date range
 *   - openInterest: per (exchange, symbol, timeframe) — row count + date range
 *
 * Used by the /market-data dashboard page.
 */

import { NextResponse } from "next/server";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";

export async function GET() {
  try {
    const repo = getTimescaleRepo();

    const [candles, fundingRates, openInterest] = await Promise.all([
      repo.getCandleCoverage(),
      repo.getFundingRateCoverage(),
      repo.getOpenInterestCoverage(),
    ]);

    return NextResponse.json({
      candles,
      fundingRates,
      openInterest,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // TimescaleDB not set up or unavailable — return empty coverage
    console.warn("[coverage] TimescaleDB unavailable:", message);
    return NextResponse.json(
      {
        candles: [],
        fundingRates: [],
        openInterest: [],
        generatedAt: new Date().toISOString(),
        error: "TimescaleDB unavailable — run npm run setup:timescale",
      },
      { status: 200 }, // 200 so the dashboard still renders
    );
  }
}
