/**
 * OpenInterestIngestionService — backfills historical open interest snapshots.
 *
 * Flow:
 *   1. Query the latest stored ts for this (exchange, symbol, timeframe) series.
 *   2. Page through provider.fetchOpenInterest() forward from that point.
 *   3. Insert with ON CONFLICT DO NOTHING — idempotent.
 *
 * Binance fetchOpenInterestHistory is capped at 500 rows / call.
 * OKX is capped at 100 rows / call — we use safeLimit=500 and the provider
 * enforces per-exchange caps.
 */

import { getProvider } from "../providers/registry";
import { getTimescaleRepo } from "../storage/timescale.repo";
import { RateLimiter, RATE_LIMITS } from "./rate-limiter";
import type { Exchange, Timeframe, IngestionJobSpec, IngestionResult } from "../types";

const PAGE_SIZE = 500;
const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

export class OpenInterestIngestionService {
  async ingest(
    spec: IngestionJobSpec,
    onProgress?: LogFn,
  ): Promise<IngestionResult> {
    const t0 = Date.now();
    const { exchange, symbol, timeframe, startTime, endTime } = spec;
    const log: LogFn = onProgress ?? ((m) => console.log(`[oi] ${m}`));

    const repo = getTimescaleRepo();
    const provider = getProvider(exchange as Exchange);
    const rateLimiter = new RateLimiter(RATE_LIMITS[exchange] ?? 60);

    // ── Determine start cursor ────────────────────────────────────────────
    const latestStored = await repo.getLatestOpenInterestTime(
      exchange as Exchange,
      symbol,
      timeframe as Timeframe,
    );
    const cursor =
      latestStored && latestStored > startTime ? latestStored : startTime;

    log(
      `Fetching open interest for ${exchange} ${symbol} ${timeframe} from ${cursor.toISOString()}`,
    );

    let totalInserted = 0;
    let pageCount = 0;

    // Most exchanges (Binance in particular) return the latest N records without
    // supporting a startTime cursor — we do a single fetch and filter by window.
    // ON CONFLICT DO NOTHING makes repeated calls safe.
    await rateLimiter.throttle();

    const rows = await fetchWithRetry(
      () => provider.fetchOpenInterest(symbol, timeframe as Timeframe, cursor, PAGE_SIZE),
      MAX_RETRIES,
      log,
    );

    if (rows.length === 0) {
      log("  No OI data returned from exchange.");
    } else {
      const inWindow = rows.filter((r) => r.ts >= startTime && r.ts < endTime);
      const inserted = await repo.insertOpenInterest(inWindow);
      totalInserted += inserted;
      pageCount = 1;

      const first = rows[0];
      const last = rows[rows.length - 1];
      log(
        `  Fetched ${rows.length} rows (${inWindow.length} in window), inserted ${inserted}. ` +
          `Range: ${first.ts.toISOString().slice(0, 10)} → ${last.ts.toISOString().slice(0, 10)}`,
      );
    }

    log(`Done. ${totalInserted} OI rows inserted.`);

    return {
      rowsInserted: totalInserted,
      gapsFilled: pageCount,
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
      const delayMs = Math.pow(2, attempt) * 1_000;
      log(`  ⚠  Attempt ${attempt}/${maxRetries} failed: ${msg}. Retrying in ${delayMs / 1_000}s…`);
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
