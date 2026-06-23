/**
 * Keltner Channels: EMA(close, period) ± mult × ATR(atrPeriod).
 * Reuses AtrDefinition.step to avoid duplicating Wilder ATR logic.
 */
import type { IndicatorDefinition, IndicatorState } from "../types";
import { createEmaAccState, stepEmaAcc } from "../utils/math";
import type { EmaAccState } from "../utils/math";
import { AtrDefinition } from "./atr";

interface KeltnerState extends Record<string, unknown> {
  emaState: EmaAccState;
  atrState: IndicatorState;
}

export const KeltnerDefinition: IndicatorDefinition = {
  id: "keltner",
  name: "Keltner Channels",
  category: "volatility",
  description: "EMA ± multiplier × ATR bands. Widens during high-volatility periods.",
  inputs: ["close"],
  parameters: [
    { name: "period",    type: "integer", label: "EMA",  default: 20, min: 1,   max: 500 },
    { name: "atrPeriod", type: "integer", label: "ATR",  default: 10, min: 1,   max: 200 },
    { name: "mult",      type: "float",   label: "Mult", default: 2,  min: 0.1, max: 10  },
  ],
  outputs: [
    { name: "upper",  label: "Upper",  type: "number" },
    { name: "middle", label: "Middle", type: "number" },
    { name: "lower",  label: "Lower",  type: "number" },
  ],
  warmupBars: (p) => Math.max(Number(p.period), Number(p.atrPeriod) + 1),
  createState: () => ({
    emaState: createEmaAccState(),
    atrState: AtrDefinition.createState({}),
  } satisfies KeltnerState),
  step({ bar, params, state }) {
    const period    = Number(params.period);
    const atrPeriod = Number(params.atrPeriod);
    const mult      = Number(params.mult ?? 2);
    const s = state as unknown as KeltnerState;

    const { value: ema, next: nextEmaState } = stepEmaAcc(s.emaState, bar.close, period);
    const atrResult = AtrDefinition.step({
      bar,
      params: { period: atrPeriod },
      state: s.atrState,
    });
    const atr          = atrResult.outputs.value;
    const nextAtrState = atrResult.nextState;

    if (ema === null || atr === null) {
      return {
        outputs: { upper: null, middle: null, lower: null },
        nextState: { emaState: nextEmaState, atrState: nextAtrState },
      };
    }

    return {
      outputs: {
        upper:  ema + mult * atr,
        middle: ema,
        lower:  ema - mult * atr,
      },
      nextState: { emaState: nextEmaState, atrState: nextAtrState },
    };
  },
};
