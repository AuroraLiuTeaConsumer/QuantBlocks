#!/usr/bin/env tsx
/**
 * Historical candle ingestion job — CLI entry point.
 *
 * Usage (defaults: Binance BTC/USDT:USDT 1h, last 90 days):
 *   npm run ingest
 *
 * Custom options:
 *   npm run ingest -- --exchange binance --symbol "BTC/USDT:USDT" --timeframe 1h --days 180
 *
 * ─── Prerequisites ───────────────────────────────────────────────────────────
 *   1. docker-compose up -d
 *      (TimescaleDB must be running with the DATABASE_URL in .env)
 *
 *   2. npm run setup:timescale
 *      (creates the candles hypertable — run once)
 *
 *   3. npx prisma migrate dev --name add_ingestion_job
 *      (creates the IngestionJob table — run once after updating schema.prisma)
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
import { prisma } from "../../lib/prisma";
import type { Exchange, Timeframe } from "../../lib/market-data/types";

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

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1_000);

  return { exchange, symbol, timeframe, startTime, endTime, days };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { exchange, symbol, timeframe, startTime, endTime, days } = parseArgs();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  QuantBlocks — Historical Candle Ingestion");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Exchange  : ${exchange}`);
  console.log(`  Symbol    : ${symbol}`);
  console.log(`  Timeframe : ${timeframe}`);
  console.log(`  Range     : last ${days} days`);
  console.log(`  From      : ${startTime.toISOString()}`);
  console.log(`  To        : ${endTime.toISOString()}`);
  console.log("───────────────────────────────────────────────────────────\n");

  // Record a job in Prisma for observability (best-effort — if Prisma table
  // doesn't exist yet the ingest still runs, job tracking is skipped).
  let jobId: string | null = null;
  try {
    const job = await prisma.ingestionJob.create({
      data: { exchange, symbol, timeframe, dataType: "candle", startTime, endTime },
    });
    jobId = job.id;
    console.log(`  Job ID: ${jobId}\n`);
  } catch {
    console.warn(
      "  ⚠  Could not create IngestionJob record (run prisma migrate dev first).\n",
    );
  }

  const service = new HistoricalDataIngestionService();

  try {
    const result = await service.ingest(
      { exchange, symbol, timeframe, startTime, endTime },
      (msg) => console.log(`  ${msg}`),
    );

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
