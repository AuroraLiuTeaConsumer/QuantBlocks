import { getProvider } from "../providers/registry";
import { getTimescaleRepo } from "../storage/timescale.repo";
import { detectGaps } from "./gap-detector";
import { RateLimiter, RATE_LIMITS } from "./rate-limiter";
import { checkCandleQuality, formatQualityReport } from "./quality-checker";
import type {
  Exchange,
  Timeframe,
  IngestionJobSpec,
  IngestionResult,
  QualityReport,
} from "../types";
import { TIMEFRAME_MS } from "../types";

const PAGE_SIZE = 1_000; // candles per CCXT request
const MAX_RETRIES = 3;

type LogFn = (msg: string) => void;

/**
 * Orchestrates historical candle backfill for a single (exchange, symbol, timeframe) series.
 *
 * Flow:
 *   1. Detect gaps via GapDetector (queries TimescaleDB, diffs against expected sequence).
 *   2. For each gap: page through provider.fetchCandles(), run quality check, insert.
 *   3. Return a summary result including aggregated QualityReport.
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

    // Accumulate quality metrics across all pages
    const aggregateQuality: QualityReport = {
      totalChecked: 0,
      ohlcErrors: 0,
      negativePrices: 0,
      volumeErrors: 0,
      spikeWarnings: 0,
    };

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
      return { rowsInserted: 0, gapsFilled: 0, durationMs: Date.now() - t0, quality: aggregateQuality };
    }

    const totalExpected = gaps.reduce(
      (s, g) => s + Math.floor((g.to.getTime() - g.from.getTime()) / tfMs),
      0,
    );
    log(`Found ${gaps.length} gap(s) — ~${totalExpected} candles to fetch.`);

    // ── 2. Fill each gap ──────────────────────────────────────────────────

    let totalInserted = 0;

    for (let gi = 0; gi < gaps.length; gi++) {
      const gap = gaps[gi];
      log(
        `Gap ${gi + 1}/${gaps.length}: ${gap.from.toISOString()} → ${gap.to.toISOString()}`,
      );

      let cursor = gap.from;

      while (cursor < gap.to) {
        await rateLimiter.throttle();

        const candles = await fetchWithRetry(
          () => provider.fetchCandles(symbol, timeframe as Timeframe, cursor, PAGE_SIZE),
          MAX_RETRIES,
          log,
        );

        if (candles.length === 0) {
          log(`  No data returned at ${cursor.toISOString()}. Skipping rest of gap.`);
          break;
        }

        // ── Quality check ─────────────────────────────────────────────────
        const { report, warnings } = checkCandleQuality(candles);

        // Accumulate into aggregate
        aggregateQuality.totalChecked += report.totalChecked;
        aggregateQuality.ohlcErrors += report.ohlcErrors;
        aggregateQuality.negativePrices += report.negativePrices;
        aggregateQuality.volumeErrors += report.volumeErrors;
        aggregateQuality.spikeWarnings += report.spikeWarnings;

        // Log individual warnings at debug level
        for (const w of warnings) {
          log(w);
        }

        // ── Insert (idempotent) ───────────────────────────────────────────
        const inserted = await repo.insertCandles(candles);
        totalInserted += inserted;

        const last = candles[candles.length - 1];
        log(
          `  → fetched ${candles.length}, inserted ${inserted}. ` +
            `Quality: ${formatQualityReport(report)}. ` +
            `Last: ${last.openTime.toISOString()}`,
        );

        const next = new Date(last.openTime.getTime() + tfMs);
        if (next >= gap.to) break;
        cursor = next;
      }
    }

    // Log aggregate quality summary if any issues were found
    const hasIssues =
      aggregateQuality.ohlcErrors > 0 ||
      aggregateQuality.negativePrices > 0 ||
      aggregateQuality.volumeErrors > 0 ||
      aggregateQuality.spikeWarnings > 0;
    if (hasIssues) {
      log(`Quality summary: ${formatQualityReport(aggregateQuality)}`);
    }

    return {
      rowsInserted: totalInserted,
      gapsFilled: gaps.length,
      durationMs: Date.now() - t0,
      quality: aggregateQuality,
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
