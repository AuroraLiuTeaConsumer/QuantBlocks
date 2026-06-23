import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingSum } from "../utils/rolling";
import { resolveInputSeries } from "../utils/math";

export const SmaDefinition: IndicatorDefinition = {
  id: "sma",
  name: "SMA",
  category: "trend",
  description: "Simple Moving Average — unweighted mean of the last N bars.",
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
  outputs: [{ name: "value", label: "SMA", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] as number[] }),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const src = resolveInputSeries(bar, String(params.field ?? "close"));
    const window = appendWindow(state.window as number[], src, period);
    const value = window.length >= period ? rollingSum(window) / period : null;
    return { outputs: { value }, nextState: { window } };
  },
};
