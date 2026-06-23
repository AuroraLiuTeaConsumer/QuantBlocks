import type { IndicatorDefinition } from "../types";
import { trueRange } from "../utils/math";

interface AtrState extends Record<string, unknown> {
  prevClose: number | null;
  atr: number | null;
  warmupCount: number;
  warmupTrSum: number;
}

export const AtrDefinition: IndicatorDefinition = {
  id: "atr",
  name: "ATR",
  category: "volatility",
  description: "Average True Range (Wilder smoothing). Measures market volatility independent of price direction.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 14, min: 1, max: 200 },
  ],
  outputs: [{ name: "value", label: "ATR", type: "number" }],
  warmupBars: (p) => Number(p.period) + 1,
  createState: () => ({
    prevClose: null,
    atr: null,
    warmupCount: 0,
    warmupTrSum: 0,
  } satisfies AtrState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s = state as unknown as AtrState;

    if (s.prevClose === null) {
      return {
        outputs: { value: null },
        nextState: { ...s, prevClose: bar.close },
      };
    }

    const tr = trueRange(bar.high, bar.low, s.prevClose);

    if (s.atr === null) {
      const warmupCount  = s.warmupCount + 1;
      const warmupTrSum  = s.warmupTrSum + tr;

      if (warmupCount < period) {
        return {
          outputs: { value: null },
          nextState: { ...s, prevClose: bar.close, warmupCount, warmupTrSum },
        };
      }

      // Seed from SMA of first `period` true ranges
      const atr = warmupTrSum / period;
      return {
        outputs: { value: atr },
        nextState: { prevClose: bar.close, atr, warmupCount, warmupTrSum },
      };
    }

    // Wilder smoothing: ATR = (ATR_prev × (period − 1) + TR) / period
    const atr = (s.atr * (period - 1) + tr) / period;
    return {
      outputs: { value: atr },
      nextState: { ...s, prevClose: bar.close, atr },
    };
  },
};
