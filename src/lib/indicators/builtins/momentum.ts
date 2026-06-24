import type { IndicatorDefinition } from "../types";
import { appendWindow } from "../utils/rolling";

interface MomentumState extends Record<string, unknown> {
  window: number[];
}

export const MomentumDefinition: IndicatorDefinition = {
  id: "momentum",
  name: "Momentum",
  category: "momentum",
  description: "Absolute price change over N bars: Close − Close[N]. Positive = upward momentum.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 10, min: 1, max: 500 },
  ],
  outputs: [{ name: "value", label: "Mom", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] } satisfies MomentumState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s      = state as unknown as MomentumState;
    const window = appendWindow(s.window, bar.close, period + 1);

    if (window.length <= period) return { outputs: { value: null }, nextState: { window } };

    return { outputs: { value: bar.close - window[0] }, nextState: { window } };
  },
};
