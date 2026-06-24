/**
 * Supertrend — ATR-based trend-following indicator.
 *
 * Algorithm per bar (after ATR is available):
 *   hl2 = (High + Low) / 2
 *   basicUpper = hl2 + mult × ATR
 *   basicLower = hl2 − mult × ATR
 *
 *   finalUpper: ratchets tighter unless price closes above the previous upper band
 *   finalLower: ratchets tighter unless price closes below the previous lower band
 *
 *   direction: flips to 1 when close > finalUpper, flips to -1 when close < finalLower
 *   supertrend: finalLower when direction=1 (support), finalUpper when direction=-1 (resistance)
 *
 * Reuses AtrDefinition.step — no ATR logic is duplicated.
 */
import type { IndicatorDefinition, IndicatorState } from "../types";
import { AtrDefinition } from "./atr";

interface SupertrendState extends Record<string, unknown> {
  atrState: IndicatorState;
  prevFinalUpper: number | null;
  prevFinalLower: number | null;
  prevClose: number | null;
  direction: number; // 1 = bullish (Supertrend is support), -1 = bearish (resistance)
}

export const SupertrendDefinition: IndicatorDefinition = {
  id: "supertrend",
  name: "Supertrend",
  category: "trend",
  description: "ATR-based trend follower. Outputs the active band (support or resistance) and direction (1 = up, -1 = down).",
  inputs: ["close"],
  parameters: [
    { name: "period", type: "integer", label: "ATR",  default: 10,  min: 1,   max: 200 },
    { name: "mult",   type: "float",   label: "Mult", default: 3.0, min: 0.1, max: 10  },
  ],
  outputs: [
    { name: "supertrend", label: "ST",  type: "number" },
    { name: "direction",  label: "Dir", type: "number" },
  ],
  warmupBars: (p) => Number(p.period) + 1,
  createState: (p) => ({
    atrState:       AtrDefinition.createState({ period: p.period ?? 10 }),
    prevFinalUpper: null,
    prevFinalLower: null,
    prevClose:      null,
    direction:      1,
  } satisfies SupertrendState),
  step({ bar, params, state }) {
    const period = Number(params.period);
    const mult   = Number(params.mult ?? 3);
    const s = state as unknown as SupertrendState;

    const atrResult    = AtrDefinition.step({ bar, params: { period }, state: s.atrState });
    const atr          = atrResult.outputs.value;
    const nextAtrState = atrResult.nextState;

    // Not enough history yet — wait for ATR and at least one prev close
    if (atr === null || s.prevClose === null) {
      return {
        outputs: { supertrend: null, direction: null },
        nextState: { ...s, atrState: nextAtrState, prevClose: bar.close },
      };
    }

    const hl2        = (bar.high + bar.low) / 2;
    const basicUpper = hl2 + mult * atr;
    const basicLower = hl2 - mult * atr;

    // Final upper band: only tighten (decrease), unless price has closed above the prior band
    const prevUpper  = s.prevFinalUpper ?? basicUpper;
    const finalUpper =
      basicUpper < prevUpper || s.prevClose > prevUpper ? basicUpper : prevUpper;

    // Final lower band: only tighten (increase), unless price has closed below the prior band
    const prevLower  = s.prevFinalLower ?? basicLower;
    const finalLower =
      basicLower > prevLower || s.prevClose < prevLower ? basicLower : prevLower;

    // Update direction
    let direction = s.direction;
    if (bar.close > finalUpper)      direction = 1;
    else if (bar.close < finalLower) direction = -1;

    const supertrend = direction === 1 ? finalLower : finalUpper;

    return {
      outputs: { supertrend, direction },
      nextState: {
        atrState:       nextAtrState,
        prevFinalUpper: finalUpper,
        prevFinalLower: finalLower,
        prevClose:      bar.close,
        direction,
      },
    };
  },
};
