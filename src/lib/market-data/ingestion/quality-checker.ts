/**
 * Data quality validation for OHLCV candles.
 *
 * Runs before bulk insert to catch data issues from the exchange API.
 * Does NOT block ingestion — issues are counted and returned in QualityReport
 * so callers can log warnings without dropping data.
 *
 * Checks performed:
 *   1. OHLC consistency  — high ≥ max(open, close) and low ≤ min(open, close)
 *   2. Negative prices   — any OHLC value ≤ 0
 *   3. Zero/neg volume   — volume ≤ 0
 *   4. Price spike       — |close − prevClose| / prevClose > SPIKE_THRESHOLD
 *
 * Outlier candles are returned separately so callers can decide whether to
 * filter them out or log them for manual review.
 */

import type { Candle } from "../types";

/** Percentage change that qualifies as a "spike" warning (15%). */
const SPIKE_THRESHOLD = 0.15;

export interface QualityReport {
  totalChecked: number;
  ohlcErrors: number;      // high < max(open,close) or low > min(open,close)
  negativePrices: number;  // any OHLC <= 0
  volumeErrors: number;    // volume <= 0
  spikeWarnings: number;   // close price moved > SPIKE_THRESHOLD vs previous bar
}

export interface QualityCheckResult {
  report: QualityReport;
  /** Indices (into the input array) of candles that failed OHLC or price checks. */
  errorIndices: Set<number>;
  /** Human-readable summary lines for logging. */
  warnings: string[];
}

export function checkCandleQuality(candles: Candle[]): QualityCheckResult {
  const report: QualityReport = {
    totalChecked: candles.length,
    ohlcErrors: 0,
    negativePrices: 0,
    volumeErrors: 0,
    spikeWarnings: 0,
  };

  const errorIndices = new Set<number>();
  const warnings: string[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // ── Negative / zero prices ────────────────────────────────────────────
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      report.negativePrices++;
      errorIndices.add(i);
      warnings.push(
        `[quality] Negative/zero price at ${c.openTime.toISOString()} ` +
          `O=${c.open} H=${c.high} L=${c.low} C=${c.close}`,
      );
    }

    // ── OHLC consistency ──────────────────────────────────────────────────
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);
    if (c.high < bodyHigh - 1e-9 || c.low > bodyLow + 1e-9) {
      report.ohlcErrors++;
      errorIndices.add(i);
      warnings.push(
        `[quality] OHLC inconsistency at ${c.openTime.toISOString()} ` +
          `H=${c.high} L=${c.low} body=[${bodyLow}, ${bodyHigh}]`,
      );
    }

    // ── Volume ────────────────────────────────────────────────────────────
    if (c.volume <= 0) {
      report.volumeErrors++;
      warnings.push(
        `[quality] Zero/neg volume at ${c.openTime.toISOString()} vol=${c.volume}`,
      );
    }

    // ── Price spike vs previous bar ───────────────────────────────────────
    if (i > 0) {
      const prev = candles[i - 1];
      if (prev.close > 0) {
        const pctChange = Math.abs(c.close - prev.close) / prev.close;
        if (pctChange > SPIKE_THRESHOLD) {
          report.spikeWarnings++;
          warnings.push(
            `[quality] Price spike at ${c.openTime.toISOString()}: ` +
              `${(pctChange * 100).toFixed(1)}% move ` +
              `(${prev.close.toFixed(2)} → ${c.close.toFixed(2)})`,
          );
        }
      }
    }
  }

  return { report, errorIndices, warnings };
}

/** Return a one-line summary of a QualityReport suitable for logging. */
export function formatQualityReport(r: QualityReport): string {
  const issues = [
    r.ohlcErrors > 0 && `${r.ohlcErrors} OHLC errors`,
    r.negativePrices > 0 && `${r.negativePrices} negative prices`,
    r.volumeErrors > 0 && `${r.volumeErrors} zero-volume bars`,
    r.spikeWarnings > 0 && `${r.spikeWarnings} spike warnings`,
  ].filter(Boolean);

  if (issues.length === 0) return `${r.totalChecked} candles OK`;
  return `${r.totalChecked} candles — ⚠ ${issues.join(", ")}`;
}
