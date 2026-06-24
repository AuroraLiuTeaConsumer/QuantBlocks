/**
 * Elder Ray Index — Bull Power and Bear Power relative to an EMA.
 *
 *   Bull Power = High − EMA(period)
 *   Bear Power = Low  − EMA(period)
 *
 * Bull Power > 0 + rising EMA = bullish. Bear Power < 0 + falling EMA = bearish.
 *
 * Demonstrates defineComposite: one sub-indicator (EMA), two derived outputs.
 */
import { defineComposite } from "../composite";
import { EmaDefinition }   from "./ema";

export const ElderRayDefinition = defineComposite({
  id: "elder_ray",
  name: "Elder Ray",
  category: "momentum",
  description: "Bull Power = High − EMA; Bear Power = Low − EMA. Measures the strength of buyers and sellers relative to trend.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 13, min: 1, max: 200 },
  ],
  outputs: [
    { name: "bullPower", label: "Bull", type: "number" },
    { name: "bearPower", label: "Bear", type: "number" },
  ],
  subIndicators: [
    {
      key: "ema",
      definition: EmaDefinition,
      params: (p) => ({ period: p.period, field: "close" }),
    },
  ],
  warmupBars: (p) => Number(p.period),
  deriveOutputs(subOutputs, _params, bar) {
    const ema = subOutputs.ema?.value ?? null;
    if (ema === null) return { bullPower: null, bearPower: null };
    return {
      bullPower: bar.high - ema,
      bearPower: bar.low  - ema,
    };
  },
});
