import type { IndicatorDefinition } from "../types";
import { appendWindow } from "../utils/rolling";
import { resolveInputSeries } from "../utils/math";

interface WmaState extends Record<string, unknown> {
  window: number[];
}

export const WmaDefinition: IndicatorDefinition = {
  id: "wma",
  name: "WMA",
  category: "trend",
  description: "Weighted Moving Average — linearly increasing weights (oldest = 1, newest = N). Reacts faster than SMA.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 20, min: 1, max: 500 },
    {
      name: "field",
      type: "select",
      label: "Source",
      default: "close",
      options: ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"],
    },
  ],
  outputs: [{ name: "value", label: "WMA", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] } satisfies WmaState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const src    = resolveInputSeries(bar, String(params.field ?? "close"));
    const s      = state as unknown as WmaState;
    const window = appendWindow(s.window, src, period);

    if (window.length < period) return { outputs: { value: null }, nextState: { window } };

    // weights: oldest = 1, next = 2, …, newest = period
    const weightSum = (period * (period + 1)) / 2;
    let wma = 0;
    for (let i = 0; i < window.length; i++) {
      wma += window[i] * (i + 1);
    }
    return { outputs: { value: wma / weightSum }, nextState: { window } };
  },
};
