import type { Exchange, Timeframe } from "../types";
import { TIMEFRAME_MS } from "../types";
import type { TimescaleRepository } from "../storage/timescale.repo";

export interface TimeRange {
  from: Date;
  to: Date; // exclusive upper bound — the next expected open_time after the gap
}

/**
 * Detect missing candle ranges for a given (exchange, symbol, timeframe) series.
 *
 * Algorithm:
 *   1. Generate every expected open_time from startTime → effectiveEnd.
 *   2. Query which timestamps are actually in TimescaleDB.
 *   3. Diff → list of missing timestamps.
 *   4. Group contiguous missing timestamps into TimeRange objects.
 *
 * The caller (HistoricalDataIngestionService) fetches one page per range,
 * advancing the cursor until the range is filled.
 */
export async function detectGaps(
  repo: TimescaleRepository,
  exchange: Exchange,
  symbol: string,
  timeframe: Timeframe,
  startTime: Date,
  endTime: Date,
): Promise<TimeRange[]> {
  const tfMs = TIMEFRAME_MS[timeframe];

  // Never ask for data beyond the last *completed* candle
  const effectiveEnd = new Date(
    Math.min(endTime.getTime(), Date.now() - tfMs),
  );

  if (effectiveEnd <= startTime) return [];

  // Generate the complete expected sequence as ms timestamps
  const expected: number[] = [];
  for (
    let ts = alignToTimeframe(startTime.getTime(), tfMs);
    ts < effectiveEnd.getTime();
    ts += tfMs
  ) {
    expected.push(ts);
  }

  if (expected.length === 0) return [];

  // Fetch what's already stored
  const existing = await repo.queryExistingTimestamps(
    exchange,
    symbol,
    timeframe,
    startTime,
    effectiveEnd,
  );
  const existingMs = new Set(existing.map((d) => d.getTime()));

  // Find missing
  const missing = expected.filter((ts) => !existingMs.has(ts));
  if (missing.length === 0) return [];

  return groupIntoRanges(missing, tfMs);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Align a ms timestamp down to the nearest timeframe boundary.
 * e.g. for 1h: 12:37 UTC → 12:00 UTC
 */
function alignToTimeframe(tsMs: number, tfMs: number): number {
  return Math.floor(tsMs / tfMs) * tfMs;
}

/**
 * Group an array of sorted missing ms timestamps into contiguous TimeRange objects.
 * Two timestamps are contiguous if their difference equals exactly one timeframe.
 */
function groupIntoRanges(missing: number[], tfMs: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  let start = missing[0];
  let prev = missing[0];

  for (let i = 1; i < missing.length; i++) {
    const ts = missing[i];
    if (ts - prev > tfMs) {
      // Break — end the current range and start a new one
      ranges.push({ from: new Date(start), to: new Date(prev + tfMs) });
      start = ts;
    }
    prev = ts;
  }

  // Flush the last range
  ranges.push({ from: new Date(start), to: new Date(prev + tfMs) });

  return ranges;
}
