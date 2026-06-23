/**
 * Bridge between the strategy engine and the indicator registry.
 * Called from engine/runtime.ts for "indicator" graph nodes.
 */
import { indicatorRegistry } from "./registry";
import type { BarSeries, IndicatorState, IndicatorCalculationResult } from "./types";

export function stepIndicatorNode(
  indicatorId: string,
  params: Record<string, number | string>,
  bar: BarSeries,
  state: IndicatorState,
): IndicatorCalculationResult {
  const def = indicatorRegistry.get(indicatorId);
  if (!def) {
    // Unknown indicator — pass through without advancing state.
    return { outputs: {}, nextState: state };
  }
  return def.step({ bar, params, state });
}
