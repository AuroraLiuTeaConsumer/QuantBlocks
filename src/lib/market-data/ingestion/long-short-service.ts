/**
 * LongShortRatioIngestionService — fetches global long/short account ratio
 * data from CoinGlass.
 *
 * Same single-call pattern as LiquidationIngestionService — CoinGlass
 * returns the full history for a symbol+timeframe in one response.
 *
 * All inserts use ON CONFLICT DO NOTHING — re-running is safe.
 */

import { getCoinGlassProvider } from "../providers/coinglass.provider";
import { getTimescaleRepo } from "../storage/timescale.repo";
import type { IngestionResult } from "../types";

const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

export interface LongShortIngestionSpec {
  /** Base ticker, e.g. 'BTC' (already converted from CCXT symbol by caller). */
  symbol: string;
  /** '1h' | '4h' | '1d' */
  timeframe: string;
  startTime: Date;
  endTime: Date;
}

export class LongShortRatioIngestionService {
  async ingest(
    spec: LongShortIngestionSpec,
    onProgress?: LogFn,
  ): Promise<IngestionResult> {
    const t0 = Date.now();
    const { symbol, timeframe, startTime, endTime } = spec;
    const log: LogFn = onProgress ?? ((m) => console.log(`[ls] ${m}`));

    const repo = getTimescaleRepo();
    const provider = getCoinGlassProvider();

    log(`Fetching long/short ratios for ${symbol} ${timeframe} from CoinGlass…`);

    const rows = await fetchWithRetry(
      () => provider.fetchLongShortRatios(symbol, timeframe),
      MAX_RETRIES,
      log,
    );

    if (rows.length === 0) {
      log("  No long/short data returned.");
      return { rowsInserted: 0, gapsFilled: 0, durationMs: Date.now() - t0 };
    }

    const inWindow = rows.filter((r) => r.ts >= startTime && r.ts < endTime);
    const inserted = await repo.insertLongShortRatios(inWindow);

    const first = rows[0];
    const last = rows[rows.length - 1];
    log(
      `  Fetched ${rows.length} rows (${inWindow.length} in window), inserted ${inserted}. ` +
        `Range: ${first.ts.toISOString().slice(0, 10)} → ${last.ts.toISOString().slice(0, 10)}`,
    );

    return { rowsInserted: inserted, gapsFilled: 1, durationMs: Date.now() - t0 };
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
      log(
        `  ⚠  Attempt ${attempt}/${maxRetries} failed: ${msg}. Retrying in ${delayMs / 1_000}s…`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
