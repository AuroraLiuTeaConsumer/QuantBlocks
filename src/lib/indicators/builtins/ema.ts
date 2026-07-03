import type { IndicatorCalculationResult, IndicatorDefinition } from "../types";
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
  warmupBars: (p) =>
    hasLegacyDualPeriods(p)
      ? Math.max(Number(p.fast), Number(p.slow))
      : Number(p.period),
  createState: (p) =>
    hasLegacyDualPeriods(p)
      ? { fast: createEmaAccState(), slow: createEmaAccState() }
      : createEmaAccState(),
  step({ bar, params, state }): IndicatorCalculationResult {
    const src = resolveInputSeries(bar, String(params.field ?? "close"));

    // Compatibility for graphs created by the earlier EMA-crossover builder,
    // which represented fast and slow EMAs as two handles on one EMA node.
    if (hasLegacyDualPeriods(params)) {
      const legacyState = state as {
        fast?: EmaAccState;
        slow?: EmaAccState;
      };
      const fast = stepEmaAcc(
        legacyState.fast ?? createEmaAccState(),
        src,
        Number(params.fast),
      );
      const slow = stepEmaAcc(
        legacyState.slow ?? createEmaAccState(),
        src,
        Number(params.slow),
      );
      return {
        outputs: { value: fast.value, fast: fast.value, slow: slow.value },
        nextState: { fast: fast.next, slow: slow.next },
      };
    }

    const period = Number(params.period);
    const { value, next } = stepEmaAcc(state as unknown as EmaAccState, src, period);
    return { outputs: { value }, nextState: next };
  },
};

function hasLegacyDualPeriods(params: Record<string, number | string>): boolean {
  const fast = Number(params.fast);
  const slow = Number(params.slow);
  return Number.isFinite(fast) && fast > 0 && Number.isFinite(slow) && slow > 0;
}
