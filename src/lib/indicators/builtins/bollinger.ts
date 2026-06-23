import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingMean, rollingStddev } from "../utils/rolling";

export const BollingerDefinition: IndicatorDefinition = {
  id: "bollinger",
  name: "Bollinger Bands",
  category: "volatility",
  description: "SMA ± k × standard deviation over N bars. Outputs upper, middle (SMA), and lower bands.",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 20, min: 2,   max: 500  },
    { name: "mult",   type: "float",   label: "Mult",   default: 2,  min: 0.1, max: 10   },
  ],
  outputs: [
    { name: "upper",  label: "Upper",  type: "number" },
    { name: "middle", label: "Middle", type: "number" },
    { name: "lower",  label: "Lower",  type: "number" },
  ],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ window: [] as number[] }),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const mult   = Number(params.mult ?? 2);
    const window = appendWindow(state.window as number[], bar.close, period);

    if (window.length < period) {
      return {
        outputs: { upper: null, middle: null, lower: null },
        nextState: { window },
      };
    }

    const middle = rollingMean(window);
    const stddev = rollingStddev(window, middle);
    const upper  = middle + mult * stddev;
    const lower  = middle - mult * stddev;

    return { outputs: { upper, middle, lower }, nextState: { window } };
  },
};
