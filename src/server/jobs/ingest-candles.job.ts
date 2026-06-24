#!/usr/bin/env tsx
/**
 * Historical data ingestion job — CLI entry point.
 *
 * Usage (defaults: Binance BTC/USDT:USDT 1h candles, last 90 days):
 *   npm run ingest
 *
 * Custom options:
 *   npm run ingest -- --exchange binance --symbol "BTC/USDT:USDT" --timeframe 1h --days 180
 *   npm run ingest -- --dataType funding_rate --days 365
 *   npm run ingest -- --dataType open_interest --timeframe 1h
 *   npm run ingest -- --exchange bybit --symbol "BTC/USDT:USDT" --dataType candle
 *   npm run ingest -- --dataType liquidation --symbol BTC --timeframe 4h
 *   npm run ingest -- --dataType long_short --symbol ETH --timeframe 1d
 *
 * ─── Prerequisites ───────────────────────────────────────────────────────────
 *   1. docker-compose up -d
 *   2. npm run setup:timescale    (creates hypertables — run once)
 *   3. npx prisma migrate dev     (creates IngestionJob table)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Load .env before any imports that read process.env
import path from "path";
import fs from "fs";

const cwd = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(cwd, f);
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^"|"$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
    break;
  }
}

import { HistoricalDataIngestionService } from "../../lib/market-data/ingestion/historical-service";
import { FundingRateIngestionService } from "../../lib/market-data/ingestion/funding-rate-service";
import { OpenInterestIngestionService } from "../../lib/market-data/ingestion/open-interest-service";
import { LiquidationIngestionService } from "../../lib/market-data/ingestion/liquidation-service";
import { LongShortRatioIngestionService } from "../../lib/market-data/ingestion/long-short-service";
import { CoinGlassProvider } from "../../lib/market-data/providers/coinglass.provider";
import { prisma } from "../../lib/prisma";
import {
  isCGTimeframe,
  toCoinGlassSymbol,
} from "../../lib/market-data/types";
import type { Exchange, Timeframe, IngestionResult } from "../../lib/market-data/types";

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const exchange = flag("--exchange", "binance") as Exchange;
  const symbol = flag("--symbol", "BTC/USDT:USDT");
  const timeframe = flag("--timeframe", "1h") as Timeframe;
  const days = parseInt(flag("--days", "90"), 10);
  const dataType = flag("--dataType", "candle");

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1_000);

  return { exchange, symbol, timeframe, startTime, endTime, days, dataType };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { exchange, symbol, timeframe, startTime, endTime, days, dataType } = parseArgs();

  // Validate CoinGlass timeframe before creating any job record
  if (dataType === "liquidation" || dataType === "long_short") {
    if (!isCGTimeframe(timeframe)) {
      console.error(
        `❌  CoinGlass only supports timeframes: 1h | 4h | 1d. Got "${timeframe}"`,
      );
      process.exit(1);
    }
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  QuantBlocks — Historical Data Ingestion");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Exchange  : ${exchange}`);
  console.log(`  Symbol    : ${symbol}`);
  console.log(`  Timeframe : ${timeframe}`);
  console.log(`  Data Type : ${dataType}`);
  console.log(`  Range     : last ${days} days`);
  console.log(`  From      : ${startTime.toISOString()}`);
  console.log(`  To        : ${endTime.toISOString()}`);
  console.log("───────────────────────────────────────────────────────────\n");

  let jobId: string | null = null;
  try {
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
    jobId = job.id;
    console.log(`  Job ID: ${jobId}\n`);
  } catch {
    console.warn(
      "  ⚠  Could not create IngestionJob record (run prisma migrate dev first).\n",
    );
  }

  try {
    let result: IngestionResult;

    if (dataType === "funding_rate") {
      const service = new FundingRateIngestionService();
      result = await service.ingest(
        { exchange, symbol, startTime, endTime },
        (msg) => console.log(`  ${msg}`),
      );
    } else if (dataType === "open_interest") {
      const service = new OpenInterestIngestionService();
      result = await service.ingest(
        { exchange, symbol, timeframe, startTime, endTime },
        (msg) => console.log(`  ${msg}`),
      );
    } else if (dataType === "liquidation") {
      if (!CoinGlassProvider.isConfigured()) {
        console.error("❌  COINGLASS_API_KEY is not set. Cannot ingest liquidation data.");
        process.exit(1);
      }
      const cgSymbol = toCoinGlassSymbol(symbol);
      const service = new LiquidationIngestionService();
      result = await service.ingest(
        { symbol: cgSymbol, timeframe, startTime, endTime },
        (msg) => console.log(`  ${msg}`),
      );
    } else if (dataType === "long_short") {
      if (!CoinGlassProvider.isConfigured()) {
        console.error("❌  COINGLASS_API_KEY is not set. Cannot ingest long/short data.");
        process.exit(1);
      }
      const cgSymbol = toCoinGlassSymbol(symbol);
      const service = new LongShortRatioIngestionService();
      result = await service.ingest(
        { symbol: cgSymbol, timeframe, startTime, endTime },
        (msg) => console.log(`  ${msg}`),
      );
    } else {
      const service = new HistoricalDataIngestionService();
      result = await service.ingest(
        { exchange, symbol, timeframe, startTime, endTime },
        (msg) => console.log(`  ${msg}`),
      );
    }

    console.log("\n───────────────────────────────────────────────────────────");
    console.log(`  ✅  Rows inserted : ${result.rowsInserted}`);
    console.log(`  Gaps filled      : ${result.gapsFilled}`);
    console.log(`  Duration         : ${(result.durationMs / 1_000).toFixed(1)}s`);
    console.log("═══════════════════════════════════════════════════════════\n");

    if (jobId) {
      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          rowsInserted: result.rowsInserted,
          completedAt: new Date(),
          meta: JSON.parse(JSON.stringify({
            gapsFilled: result.gapsFilled,
            durationMs: result.durationMs,
            quality: result.quality ?? null,
          })),
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\n❌  Ingestion failed:", message);

    if (jobId) {
      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: { status: "failed", error: message, completedAt: new Date() },
      });
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  process.exit(0);
}

main();
