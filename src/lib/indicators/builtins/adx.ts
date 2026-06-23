import type { IndicatorDefinition } from "../types";
import { trueRange } from "../utils/math";

/**
 * ADX with +DI/-DI (Wilder smoothing throughout).
 *
 * Warmup phases:
 *   Phase 1 — bars 1..period: accumulate TR, +DM, -DM sums (seed)
 *   Phase 2 — bars period+1..2*period: Wilder-smooth TR/DM; accumulate DX values (ADX seed)
 *   Phase 3 — bars 2*period+1..: Wilder-smooth ADX
 *
 * First non-null ADX appears at bar index 2*period.
 */

interface AdxState extends Record<string, unknown> {
  // Previous bar values
  prevHigh:  number | null;
  prevLow:   number | null;
  prevClose: number | null;
  // Phase 1: warmup sums for Wilder seed (stored as running totals, not means)
  warmupTRSum:      number;
  warmupPlusDMSum:  number;
  warmupMinusDMSum: number;
  warmupCount:      number;
  // Phase 2+: Wilder smoothed TR and directional movement
  smoothedTR:      number | null;
  smoothedPlusDM:  number | null;
  smoothedMinusDM: number | null;
  // Phase 2: accumulate DX values to seed ADX
  warmupDXSum:   number;
  warmupDXCount: number;
  // Phase 3: smoothed ADX
  smoothedADX: number | null;
}

export const AdxDefinition: IndicatorDefinition = {
  id: "adx",
  name: "ADX",
  category: "trend",
  description: "Average Directional Index with +DI and -DI (Wilder smoothing). ADX > 25 signals a trending market.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 14, min: 2, max: 200 },
  ],
  outputs: [
    { name: "adx",     label: "ADX",  type: "number" },
    { name: "diPlus",  label: "+DI",  type: "number" },
    { name: "diMinus", label: "-DI",  type: "number" },
  ],
  warmupBars: (p) => 2 * Number(p.period),
  createState: () => ({
    prevHigh:  null,
    prevLow:   null,
    prevClose: null,
    warmupTRSum:      0,
    warmupPlusDMSum:  0,
    warmupMinusDMSum: 0,
    warmupCount:      0,
    smoothedTR:      null,
    smoothedPlusDM:  null,
    smoothedMinusDM: null,
    warmupDXSum:   0,
    warmupDXCount: 0,
    smoothedADX: null,
  } satisfies AdxState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s = state as unknown as AdxState;

    // First bar — just store previous values, no computation possible
    if (s.prevClose === null) {
      return {
        outputs: { adx: null, diPlus: null, diMinus: null },
        nextState: { ...s, prevHigh: bar.high, prevLow: bar.low, prevClose: bar.close },
      };
    }

    const tr       = trueRange(bar.high, bar.low, s.prevClose);
    const upMove   = bar.high - s.prevHigh!;
    const downMove = s.prevLow! - bar.low;
    const plusDM   = upMove > 0 && upMove > downMove ? upMove : 0;
    const minusDM  = downMove > 0 && downMove > upMove ? downMove : 0;

    const nextPrev = { prevHigh: bar.high, prevLow: bar.low, prevClose: bar.close };

    // ── Phase 1: accumulate until we have `period` TR/DM values ──────────
    if (s.smoothedTR === null) {
      const warmupCount    = s.warmupCount + 1;
      const warmupTRSum    = s.warmupTRSum    + tr;
      const warmupPlusDMSum  = s.warmupPlusDMSum  + plusDM;
      const warmupMinusDMSum = s.warmupMinusDMSum + minusDM;

      if (warmupCount < period) {
        return {
          outputs: { adx: null, diPlus: null, diMinus: null },
          nextState: { ...s, ...nextPrev, warmupCount, warmupTRSum, warmupPlusDMSum, warmupMinusDMSum },
        };
      }

      // Seed Wilder smoothed values from running sums (Wilder convention: initial = sum, not mean)
      const smoothedTR      = warmupTRSum;
      const smoothedPlusDM  = warmupPlusDMSum;
      const smoothedMinusDM = warmupMinusDMSum;

      const { diPlus, diMinus, dx } = computeDI(smoothedTR, smoothedPlusDM, smoothedMinusDM);

      return {
        outputs: { adx: null, diPlus, diMinus },
        nextState: {
          ...s, ...nextPrev,
          warmupCount, warmupTRSum, warmupPlusDMSum, warmupMinusDMSum,
          smoothedTR, smoothedPlusDM, smoothedMinusDM,
          warmupDXSum: dx, warmupDXCount: 1,
        },
      };
    }

    // ── Phase 2+: Wilder-smooth TR and DM ────────────────────────────────
    const smoothedTR      = s.smoothedTR      - s.smoothedTR      / period + tr;
    const smoothedPlusDM  = s.smoothedPlusDM!  - s.smoothedPlusDM!  / period + plusDM;
    const smoothedMinusDM = s.smoothedMinusDM! - s.smoothedMinusDM! / period + minusDM;

    const { diPlus, diMinus, dx } = computeDI(smoothedTR, smoothedPlusDM, smoothedMinusDM);

    if (s.smoothedADX === null) {
      // ── Phase 2: accumulate DX until we have enough to seed ADX ──────
      const warmupDXCount = s.warmupDXCount + 1;
      const warmupDXSum   = s.warmupDXSum   + dx;

      if (warmupDXCount < period) {
        return {
          outputs: { adx: null, diPlus, diMinus },
          nextState: { ...s, ...nextPrev, smoothedTR, smoothedPlusDM, smoothedMinusDM, warmupDXSum, warmupDXCount },
        };
      }

      // Seed ADX from mean of accumulated DX values
      const smoothedADX = warmupDXSum / period;
      return {
        outputs: { adx: smoothedADX, diPlus, diMinus },
        nextState: { ...s, ...nextPrev, smoothedTR, smoothedPlusDM, smoothedMinusDM, warmupDXSum, warmupDXCount, smoothedADX },
      };
    }

    // ── Phase 3: Wilder-smooth ADX ────────────────────────────────────────
    const smoothedADX = (s.smoothedADX * (period - 1) + dx) / period;
    return {
      outputs: { adx: smoothedADX, diPlus, diMinus },
      nextState: { ...s, ...nextPrev, smoothedTR, smoothedPlusDM, smoothedMinusDM, smoothedADX },
    };
  },
};

function computeDI(
  smoothedTR: number,
  smoothedPlusDM: number,
  smoothedMinusDM: number,
): { diPlus: number; diMinus: number; dx: number } {
  const diPlus  = smoothedTR === 0 ? 0 : (100 * smoothedPlusDM)  / smoothedTR;
  const diMinus = smoothedTR === 0 ? 0 : (100 * smoothedMinusDM) / smoothedTR;
  const diSum   = diPlus + diMinus;
  const dx      = diSum  === 0 ? 0 : (100 * Math.abs(diPlus - diMinus)) / diSum;
  return { diPlus, diMinus, dx };
}
