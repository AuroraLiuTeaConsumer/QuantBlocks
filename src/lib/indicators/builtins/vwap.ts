import type { IndicatorDefinition } from "../types";
import { appendWindow, rollingSum } from "../utils/rolling";

interface VwapState extends Record<string, unknown> {
  tpVolWindow: number[];
  volWindow: number[];
}

export const VwapDefinition: IndicatorDefinition = {
  id: "vwap",
  name: "VWAP",
  category: "volume",
  description: "Volume Weighted Average Price over N bars using typical price (HLC/3).",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "Period", default: 20, min: 1, max: 500 },
  ],
  outputs: [{ name: "value", label: "VWAP", type: "number" }],
  warmupBars: (p) => Number(p.period),
  createState: () => ({ tpVolWindow: [], volWindow: [] } satisfies VwapState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const s = state as unknown as VwapState;

    const tp  = (bar.high + bar.low + bar.close) / 3;
    const vol = bar.volume ?? 0;

    const tpVolWindow = appendWindow(s.tpVolWindow, tp * vol, period);
    const volWindow   = appendWindow(s.volWindow,   vol,      period);

    if (tpVolWindow.length < period) {
      return { outputs: { value: null }, nextState: { tpVolWindow, volWindow } };
    }

    const totalVol = rollingSum(volWindow);
    const value    = totalVol === 0 ? null : rollingSum(tpVolWindow) / totalVol;
    return { outputs: { value }, nextState: { tpVolWindow, volWindow } };
  },
};
