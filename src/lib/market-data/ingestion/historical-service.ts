import { getProvider } from "../providers/registry";
import { getTimescaleRepo } from "../storage/timescale.repo";
import { detectGaps } from "./gap-detector";
import { RateLimiter, RATE_LIMITS } from "./rate-limiter";
import type { Exchange, Timeframe, IngestionJobSpec, IngestionResult } from "../types";
import { TIMEFRAME_MS } from "../types";

const PAGE_SIZE = 1_000; // candles per CCXT request
const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

/**
 * Orchestrates historical candle backfill for a single (exchange, symbol, timeframe) series.
 *
 * Flow:
 *   1. Detect gaps via GapDetector (queries TimescaleDB, diffs against expected sequence).
 *   2. For each gap: page through provider.fetchCandles(), insert, advance cursor.
 *   3. Return a summary result.
 *
 * All inserts use ON CONFLICT DO NOTHING — re-running is safe.
 */
export class HistoricalDataIngestionService {
  async ingest(
    spec: IngestionJobSpec,
    onProgress?: LogFn,
  ): Promise<IngestionResult> {
    const t0 = Date.now();
    const { exchange, symbol, timeframe, startTime, endTime } = spec;
    const log: LogFn = onProgress ?? ((m) => console.log(`[ingest] ${m}`));

    const repo = getTimescaleRepo();
    const provider = getProvider(exchange as Exchange);
    const rateLimiter = new RateLimiter(RATE_LIMITS[exchange] ?? 60);
    const tfMs = TIMEFRAME_MS[timeframe as Timeframe];

    // ── 1. Gap detection ──────────────────────────────────────────────────

    log(`Detecting gaps for ${exchange} ${symbol} ${timeframe}…`);
    const gaps = await detectGaps(
      repo,
      exchange as Exchange,
      symbol,
      timeframe as Timeframe,
      startTime,
      endTime,
    );

    if (gaps.length === 0) {
      log("No gaps found — data is already up to date.");
      return { rowsInserted: 0, gapsFilled: 0, durationMs: Date.now() - t0 };
    }

    const totalExpected = gaps.reduce(
      (s, g) =>
        s + Math.floor((g.to.getTime() - g.from.getTime()) / tfMs),
      0,
    );
    log(
      `Found ${gaps.length} gap(s) — ~${totalExpected} candles to fetch.`,
    );

    // ── 2. Fill each gap ──────────────────────────────────────────────────

    let totalInserted = 0;

    for (let gi = 0; gi < gaps.length; gi++) {
      const gap = gaps[gi];
      log(
        `Gap ${gi + 1}/${gaps.length}: ${gap.from.toISOString()} → ${gap.to.toISOString()}`,
      );

      let cursor = gap.from;

      while (cursor < gap.to) {
        // Honour exchange rate limit before each request
        await rateLimiter.throttle();

        // Fetch one page (with retry on transient errors)
        const candles = await fetchWithRetry(
          () =>
            provider.fetchCandles(symbol, timeframe as Timeframe, cursor, PAGE_SIZE),
          MAX_RETRIES,
          log,
        );

        if (candles.length === 0) {
          // Exchange returned nothing — no more data for this range
          log(`  No data returned at ${cursor.toISOString()}. Skipping rest of gap.`);
          break;
        }

        // Insert (idempotent)
        const inserted = await repo.insertCandles(candles);
        totalInserted += inserted;

        const last = candles[candles.length - 1];
        log(
          `  → fetched ${candles.length}, inserted ${inserted}. ` +
            `Last candle: ${last.openTime.toISOString()}`,
        );

        // Advance cursor to the candle after the last one returned
        const next = new Date(last.openTime.getTime() + tfMs);
        if (next >= gap.to) break;
        cursor = next;
      }
    }

    return {
      rowsInserted: totalInserted,
      gapsFilled: gaps.length,
      durationMs: Date.now() - t0,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  log: LogFn,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const delayMs = Math.pow(2, attempt) * 1_000; // 2 s, 4 s, 8 s
      log(
        `  ⚠  Attempt ${attempt}/${maxRetries} failed: ${msg}. ` +
          `Retrying in ${delayMs / 1_000}s…`,
      );
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
