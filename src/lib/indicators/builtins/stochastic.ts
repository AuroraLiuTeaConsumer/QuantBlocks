import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingMax, rollingMin, rollingMean } from "../utils/rolling";

interface StochasticState extends Record<string, unknown> {
  highWindow: number[];
  lowWindow: number[];
  dWindow: number[];
}

export const StochasticDefinition: IndicatorDefinition = {
  id: "stochastic",
  name: "Stochastic",
  category: "momentum",
  description: "Stochastic Oscillator: %K = position of close in the N-bar high/low range; %D = SMA of %K.",
  inputs: ["close"],
  parameters: [
    { name: "kPeriod", type: "integer", label: "%K period", default: 14, min: 1, max: 200 },
    { name: "dPeriod", type: "integer", label: "%D period", default: 3,  min: 1, max: 50  },
  ],
  outputs: [
    { name: "k", label: "%K", type: "number" },
    { name: "d", label: "%D", type: "number" },
  ],
  warmupBars: (p) => Number(p.kPeriod) + Number(p.dPeriod) - 1,
  createState: () => ({ highWindow: [], lowWindow: [], dWindow: [] } satisfies StochasticState),
  step({ bar, params, state }) {
    const kPeriod = Number(params.kPeriod);
    const dPeriod = Number(params.dPeriod);
    const s = state as unknown as StochasticState;

    const highWindow = appendWindow(s.highWindow, bar.high, kPeriod);
    const lowWindow  = appendWindow(s.lowWindow,  bar.low,  kPeriod);

    if (highWindow.length < kPeriod) {
      return {
        outputs: { k: null, d: null },
        nextState: { highWindow, lowWindow, dWindow: s.dWindow },
      };
    }

    const hh    = rollingMax(highWindow);
    const ll    = rollingMin(lowWindow);
    const range = hh - ll;
    const k     = range === 0 ? 50 : ((bar.close - ll) / range) * 100;

    const dWindow = appendWindow(s.dWindow, k, dPeriod);
    const d       = dWindow.length >= dPeriod ? rollingMean(dWindow) : null;

    return { outputs: { k, d }, nextState: { highWindow, lowWindow, dWindow } };
  },
};
