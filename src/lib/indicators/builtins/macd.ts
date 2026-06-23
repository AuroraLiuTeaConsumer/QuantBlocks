import type { IndicatorDefinition } from "../types";
import { createEmaAccState, stepEmaAcc } from "../utils/math";
import type { EmaAccState } from "../utils/math";

interface MacdState extends Record<string, unknown> {
  fastEma: EmaAccState;
  slowEma: EmaAccState;
  signalEma: EmaAccState;
}

export const MacdDefinition: IndicatorDefinition = {
  id: "macd",
  name: "MACD",
  category: "momentum",
  description: "Moving Average Convergence/Divergence — fast EMA minus slow EMA, with a signal EMA and histogram.",
  inputs: ["close"],
  parameters: [
    { name: "fast",   type: "integer", label: "Fast",   default: 12, min: 1, max: 200 },
    { name: "slow",   type: "integer", label: "Slow",   default: 26, min: 1, max: 500 },
    { name: "signal", type: "integer", label: "Signal", default: 9,  min: 1, max: 200 },
  ],
  outputs: [
    { name: "macdLine",   label: "MACD",    type: "number" },
    { name: "signalLine", label: "Signal",  type: "number" },
    { name: "histogram",  label: "Hist",    type: "number" },
  ],
  warmupBars: (p) => Math.max(Number(p.fast), Number(p.slow)) + Number(p.signal) - 1,
  createState: () => ({
    fastEma:   createEmaAccState(),
    slowEma:   createEmaAccState(),
    signalEma: createEmaAccState(),
  }),
  step({ bar, params, state }) {
    const fast   = Number(params.fast);
    const slow   = Number(params.slow);
    const signal = Number(params.signal);
    const s = state as unknown as MacdState;

    const { value: fastVal, next: nextFast } = stepEmaAcc(s.fastEma, bar.close, fast);
    const { value: slowVal, next: nextSlow } = stepEmaAcc(s.slowEma, bar.close, slow);

    if (fastVal === null || slowVal === null) {
      return {
        outputs: { macdLine: null, signalLine: null, histogram: null },
        nextState: { fastEma: nextFast, slowEma: nextSlow, signalEma: s.signalEma },
      };
    }

    const macdLine = fastVal - slowVal;
    const { value: signalVal, next: nextSignal } = stepEmaAcc(s.signalEma, macdLine, signal);
    const histogram = signalVal !== null ? macdLine - signalVal : null;

    return {
      outputs: { macdLine, signalLine: signalVal, histogram },
      nextState: { fastEma: nextFast, slowEma: nextSlow, signalEma: nextSignal },
    };
  },
};
