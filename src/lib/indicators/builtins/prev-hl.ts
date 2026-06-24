import type { IndicatorDefinition } from "../types";
import { appendWindow } from "../utils/rolling";

interface PrevHlState extends Record<string, unknown> {
  highWindow: number[];
  lowWindow:  number[];
}

/**
 * Previous High / Previous Low — the high and low from N bars ago.
 * With period=1 (default): previous bar's high and low.
 * With period=5: the high and low from 5 bars ago.
 *
 * Useful for conditions like "close > previous high" or "retests previous low."
 */
export const PrevHlDefinition: IndicatorDefinition = {
  id: "prev_hl",
  name: "Prev High/Low",
  category: "other",
  description: "High and low from N bars ago. Default period=1 gives the previous bar's high/low.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Lookback", default: 1, min: 1, max: 500 },
  ],
  outputs: [
    { name: "high", label: "Prev H", type: "number" },
    { name: "low",  label: "Prev L", type: "number" },
  ],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ highWindow: [], lowWindow: [] } satisfies PrevHlState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s      = state as unknown as PrevHlState;

    // window size = period + 1: oldest entry is exactly N bars ago
    const highWindow = appendWindow(s.highWindow, bar.high, period + 1);
    const lowWindow  = appendWindow(s.lowWindow,  bar.low,  period + 1);

    if (highWindow.length <= period) {
      return { outputs: { high: null, low: null }, nextState: { highWindow, lowWindow } };
    }

    return {
      outputs: { high: highWindow[0], low: lowWindow[0] },
      nextState: { highWindow, lowWindow },
    };
  },
};
