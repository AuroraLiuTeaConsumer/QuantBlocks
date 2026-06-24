import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingMean } from "../utils/rolling";

interface CciState extends Record<string, unknown> {
  window: number[]; // rolling window of typical prices
}

export const CciDefinition: IndicatorDefinition = {
  id: "cci",
  name: "CCI",
  category: "momentum",
  description: "Commodity Channel Index — measures how far price deviates from its SMA relative to mean deviation. ±100 are classic signal thresholds.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 20, min: 2, max: 500 },
  ],
  outputs: [{ name: "value", label: "CCI", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] } satisfies CciState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const tp     = (bar.high + bar.low + bar.close) / 3;
    const s      = state as unknown as CciState;
    const window = appendWindow(s.window, tp, period);

    if (window.length < period) return { outputs: { value: null }, nextState: { window } };

    const sma     = rollingMean(window);
    let madSum    = 0;
    for (const v of window) madSum += Math.abs(v - sma);
    const mad     = madSum / period;               // mean absolute deviation
    const value   = mad === 0 ? 0 : (tp - sma) / (0.015 * mad);

    return { outputs: { value }, nextState: { window } };
  },
};
