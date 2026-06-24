import type { IndicatorDefinition } from "../types";
import { appendWindow } from "../utils/rolling";

interface RocState extends Record<string, unknown> {
  window: number[]; // rolling window of size period + 1
}

export const RocDefinition: IndicatorDefinition = {
  id: "roc",
  name: "Rate of Change",
  category: "momentum",
  description: "Percentage change from N bars ago: (Close − Close[N]) / Close[N] × 100.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 12, min: 1, max: 500 },
  ],
  outputs: [{ name: "value", label: "ROC %", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] } satisfies RocState),
  step({ bar, params, state }) {
    const period   = Number(params.period);
    const s        = state as unknown as RocState;
    // Keep period + 1 values so window[0] is always N bars ago
    const window   = appendWindow(s.window, bar.close, period + 1);

    if (window.length <= period) return { outputs: { value: null }, nextState: { window } };

    const prevClose = window[0];
    const value     = prevClose === 0 ? 0 : ((bar.close - prevClose) / prevClose) * 100;
    return { outputs: { value }, nextState: { window } };
  },
};
