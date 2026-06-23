import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingMax, rollingMin } from "../utils/rolling";

interface DonchianState extends Record<string, unknown> {
  highWindow: number[];
  lowWindow:  number[];
}

export const DonchianDefinition: IndicatorDefinition = {
  id: "donchian",
  name: "Donchian Channels",
  category: "trend",
  description: "Highest high and lowest low over N bars. The middle band is their midpoint.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 20, min: 1, max: 500 },
  ],
  outputs: [
    { name: "upper",  label: "Upper",  type: "number" },
    { name: "middle", label: "Middle", type: "number" },
    { name: "lower",  label: "Lower",  type: "number" },
  ],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ highWindow: [], lowWindow: [] } satisfies DonchianState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s = state as unknown as DonchianState;

    const highWindow = appendWindow(s.highWindow, bar.high, period);
    const lowWindow  = appendWindow(s.lowWindow,  bar.low,  period);

    if (highWindow.length < period) {
      return {
        outputs: { upper: null, middle: null, lower: null },
        nextState: { highWindow, lowWindow },
      };
    }

    const upper  = rollingMax(highWindow);
    const lower  = rollingMin(lowWindow);
    const middle = (upper + lower) / 2;

    return { outputs: { upper, middle, lower }, nextState: { highWindow, lowWindow } };
  },
};
