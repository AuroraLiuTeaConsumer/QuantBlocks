/**
 * Wilder RSI — same algorithm as engine/indicators/rsi.ts but registered
 * in the indicator registry so "indicator" graph nodes can use it.
 * The legacy "rsi" graph node type continues to work unchanged.
 */
import type { IndicatorDefinition } from "../types";

interface RsiAccState extends Record<string, unknown> {
  lastClose: number | null;
  warmupCount: number;
  warmupSumGain: number;
  warmupSumLoss: number;
  avgGain: number;
  avgLoss: number;
  initialized: boolean;
}

export const RsiDefinition: IndicatorDefinition = {
  id: "rsi",
  name: "RSI",
  category: "momentum",
  description: "Relative Strength Index (Wilder smoothing). 0–100; oversold < 30, overbought > 70.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 14, min: 2, max: 200 },
  ],
  outputs: [{ name: "value", label: "RSI", type: "number" }],
  warmupBars: (p) => Number(p.period) + 1,
  createState: () => ({
    lastClose: null,
    warmupCount: 0,
    warmupSumGain: 0,
    warmupSumLoss: 0,
    avgGain: 0,
    avgLoss: 0,
    initialized: false,
  } satisfies RsiAccState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s = state as unknown as RsiAccState;

    if (s.lastClose === null) {
      return {
        outputs: { value: null },
        nextState: { ...s, lastClose: bar.close },
      };
    }

    const change = bar.close - s.lastClose;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!s.initialized) {
      const warmupCount = s.warmupCount + 1;
      const warmupSumGain = s.warmupSumGain + gain;
      const warmupSumLoss = s.warmupSumLoss + loss;

      if (warmupCount < period) {
        return {
          outputs: { value: null },
          nextState: { ...s, lastClose: bar.close, warmupCount, warmupSumGain, warmupSumLoss },
        };
      }

      // Seed from SMA of first `period` changes
      const avgGain = warmupSumGain / period;
      const avgLoss = warmupSumLoss / period;
      const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      return {
        outputs: { value },
        nextState: {
          lastClose: bar.close,
          warmupCount,
          warmupSumGain,
          warmupSumLoss,
          avgGain,
          avgLoss,
          initialized: true,
        },
      };
    }

    // Wilder smoothing
    const avgGain = (s.avgGain * (period - 1) + gain) / period;
    const avgLoss = (s.avgLoss * (period - 1) + loss) / period;
    const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    return {
      outputs: { value },
      nextState: { ...s, lastClose: bar.close, avgGain, avgLoss },
    };
  },
};
