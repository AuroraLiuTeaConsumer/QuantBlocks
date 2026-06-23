import type { IndicatorDefinition } from "../types";
import { createEmaAccState, stepEmaAcc, resolveInputSeries } from "../utils/math";
import type { EmaAccState } from "../utils/math";

export const EmaDefinition: IndicatorDefinition = {
  id: "ema",
  name: "EMA",
  category: "trend",
  description: "Exponential Moving Average — weights recent bars more heavily (α = 2/(N+1)). Seeds from SMA.",
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
  outputs: [{ name: "value", label: "EMA", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => createEmaAccState(),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const src = resolveInputSeries(bar, String(params.field ?? "close"));
    const { value, next } = stepEmaAcc(state as unknown as EmaAccState, src, period);
    return { outputs: { value }, nextState: next };
  },
};
