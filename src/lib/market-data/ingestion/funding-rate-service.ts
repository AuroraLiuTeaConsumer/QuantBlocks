/**
 * FundingRateIngestionService — backfills historical funding rate events.
 *
 * Flow:
 *   1. Query the latest stored funding_time for this series.
 *   2. Page through provider.fetchFundingRates() from that point forward.
 *   3. Insert with ON CONFLICT DO NOTHING — idempotent, safe to re-run.
 *
 * Funding events are sparse (3 / day on most perp exchanges) so rate
 * limiting is conservative and page sizes are small (1 000).
 */

import { getProvider } from "../providers/registry";
import { getTimescaleRepo } from "../storage/timescale.repo";
import { RateLimiter, RATE_LIMITS } from "./rate-limiter";
import type { Exchange, IngestionJobSpec, IngestionResult } from "../types";

const PAGE_SIZE = 1_000;
const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

export class FundingRateIngestionService {
  async ingest(
    spec: Pick<IngestionJobSpec, "exchange" | "symbol" | "startTime" | "endTime">,
    onProgress?: LogFn,
  ): Promise<IngestionResult> {
    const t0 = Date.now();
    const { exchange, symbol, startTime, endTime } = spec;
    const log: LogFn = onProgress ?? ((m) => console.log(`[funding] ${m}`));

    const repo = getTimescaleRepo();
    const provider = getProvider(exchange as Exchange);
    const rateLimiter = new RateLimiter(RATE_LIMITS[exchange] ?? 60);

    // ── Determine start cursor ────────────────────────────────────────────
    // Resume from the last stored event to fill gaps incrementally.
    const latestStored = await repo.getLatestFundingTime(exchange as Exchange, symbol);
    const cursor = latestStored && latestStored > startTime ? latestStored : startTime;

    log(`Fetching funding rates for ${exchange} ${symbol} from ${cursor.toISOString()}`);

    let totalInserted = 0;
    let pageCount = 0;
    let currentCursor = cursor;

    while (currentCursor < endTime) {
      await rateLimiter.throttle();

      const rates = await fetchWithRetry(
        () => provider.fetchFundingRates(symbol, currentCursor, PAGE_SIZE),
        MAX_RETRIES,
        log,
      );

      if (rates.length === 0) {
        log(`  No more funding data at ${currentCursor.toISOString()}.`);
        break;
      }

      // Filter to requested window
      const inWindow = rates.filter(
        (r) => r.fundingTime >= startTime && r.fundingTime < endTime,
      );

      const inserted = await repo.insertFundingRates(inWindow);
      totalInserted += inserted;
      pageCount++;

      const last = rates[rates.length - 1];
      log(
        `  Page ${pageCount}: fetched ${rates.length}, inserted ${inserted}. ` +
          `Last: ${last.fundingTime.toISOString()} rate=${(last.fundingRate * 100).toFixed(4)}%`,
      );

      // Advance cursor past the last event
      const nextMs = last.fundingTime.getTime() + 1;
      if (nextMs >= endTime.getTime()) break;
      currentCursor = new Date(nextMs);

      // If we got fewer than PAGE_SIZE, we've reached the end of available data
      if (rates.length < PAGE_SIZE) break;
    }

    log(`Done. ${totalInserted} funding rate rows inserted in ${pageCount} page(s).`);

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
