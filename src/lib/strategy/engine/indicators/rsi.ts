/**
 * Wilder RSI indicator — pure, serializable state.
 *
 * Initialization: accumulate gains/losses for `period` bars, then SMA seed.
 * After init: Wilder smoothing (exponential).
 */

import type { RsiState } from "../types";

export function createRsiState(period: number): RsiState {
  return {
    period,
    avgGain: 0,
    avgLoss: 0,
    lastClose: null,
    warmupCount: 0,
    initialized: false,
  };
}

/**
 * Feed one close price. Returns { value, nextState }.
 * value is null during warmup.
 */
export function stepRsi(
  state: RsiState,
  close: number,
): { value: number | null; nextState: RsiState } {
  const s = { ...state };

  if (s.lastClose === null) {
    // Very first bar — no change yet, just record close
    s.lastClose = close;
    return { value: null, nextState: s };
  }

  const change = close - s.lastClose;
  s.lastClose = close;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? Math.abs(change) : 0;

  if (!s.initialized) {
    s.avgGain += gain;
    s.avgLoss += loss;
    s.warmupCount += 1;

    if (s.warmupCount >= s.period) {
      // Seed with SMA
      s.avgGain = s.avgGain / s.period;
      s.avgLoss = s.avgLoss / s.period;
      s.initialized = true;
      const value = s.avgLoss === 0 ? 100 : 100 - 100 / (1 + s.avgGain / s.avgLoss);
      return { value, nextState: s };
    }

    return { value: null, nextState: s };
  }

  // Wilder smoothing
  s.avgGain = (s.avgGain * (s.period - 1) + gain) / s.period;
  s.avgLoss = (s.avgLoss * (s.period - 1) + loss) / s.period;

  const value = s.avgLoss === 0 ? 100 : 100 - 100 / (1 + s.avgGain / s.avgLoss);
  return { value, nextState: s };
}
