/**
 * LiquidationIngestionService — fetches global liquidation data from CoinGlass.
 *
 * CoinGlass returns the full available history for a symbol+timeframe in a
 * single response, so there is no cursor-based paging. The response is
 * filtered to the requested [startTime, endTime) window before inserting.
 *
 * All inserts use ON CONFLICT DO NOTHING — re-running is safe.
 */

import { getCoinGlassProvider } from "../providers/coinglass.provider";
import { getTimescaleRepo } from "../storage/timescale.repo";
import type { IngestionResult } from "../types";

const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

export interface LiquidationIngestionSpec {
  /** Base ticker, e.g. 'BTC' (already converted from CCXT symbol by caller). */
  symbol: string;
  /** '1h' | '4h' | '1d' */
  timeframe: string;
  startTime: Date;
  endTime: Date;
}

export class LiquidationIngestionService {
  async ingest(
    spec: LiquidationIngestionSpec,
    onProgress?: LogFn,
  ): Promise<IngestionResult> {
    const t0 = Date.now();
    const { symbol, timeframe, startTime, endTime } = spec;
    const log: LogFn = onProgress ?? ((m) => console.log(`[liq] ${m}`));

    const repo = getTimescaleRepo();
    const provider = getCoinGlassProvider();

    log(`Fetching liquidations for ${symbol} ${timeframe} from CoinGlass…`);

    const rows = await fetchWithRetry(
      () => provider.fetchLiquidations(symbol, timeframe),
      MAX_RETRIES,
      log,
    );

    if (rows.length === 0) {
      log("  No liquidation data returned.");
      return { rowsInserted: 0, gapsFilled: 0, durationMs: Date.now() - t0 };
    }

    const inWindow = rows.filter((r) => r.ts >= startTime && r.ts < endTime);
    const inserted = await repo.insertLiquidations(inWindow);

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
