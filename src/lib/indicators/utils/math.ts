/**
 * Shared math helpers used by multiple indicator builtins.
 */

/** True Range = max(H−L, |H−prevClose|, |L−prevClose|). */
export function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
}

/** Resolve a named price field from a bar. */
export function resolveInputSeries(
  bar: { open: number; high: number; low: number; close: number; volume?: number },
  field: string,
): number {
  switch (field) {
    case "open":   return bar.open;
    case "high":   return bar.high;
    case "low":    return bar.low;
    case "volume": return bar.volume ?? 0;
    case "hl2":    return (bar.high + bar.low) / 2;
    case "hlc3":   return (bar.high + bar.low + bar.close) / 3;
    case "ohlc4":  return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:       return bar.close;
  }
}

// ── EMA stepping ─────────────────────────────────────────────

/**
 * Internal EMA accumulator state.
 * Exported so MACD and Keltner can reuse it without duplicating logic.
 */
export interface EmaAccState extends Record<string, unknown> {
  ema: number | null;
  warmupCount: number;
  warmupSum: number;
}

export function createEmaAccState(): EmaAccState {
  return { ema: null, warmupCount: 0, warmupSum: 0 };
}

/**
 * Advance one EMA step. Seeds from SMA after `period` bars; uses
 * standard EMA smoothing (α = 2 / (period + 1)) thereafter.
 * Pure — never mutates `s`.
 */
export function stepEmaAcc(
  s: EmaAccState,
  value: number,
  period: number,
): { value: number | null; next: EmaAccState } {
  const warmupCount = s.warmupCount + 1;
  const warmupSum = s.warmupSum + value;

  if (warmupCount < period) {
    return { value: null, next: { ema: null, warmupCount, warmupSum } };
  }

  if (warmupCount === period) {
    const ema = warmupSum / period;
    return { value: ema, next: { ema, warmupCount, warmupSum } };
  }

  // warmupCount > period — apply EMA smoothing
  const alpha = 2 / (period + 1);
  const ema = s.ema! + alpha * (value - s.ema!);
  return { value: ema, next: { ema, warmupCount, warmupSum } };
}
