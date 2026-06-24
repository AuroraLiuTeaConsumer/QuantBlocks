/**
 * Composite indicator factory.
 *
 * A composite indicator delegates to one or more existing IndicatorDefinitions.
 * Sub-indicators are referenced directly (not through the registry), which:
 *   - avoids circular imports between registry.ts and composite builtins
 *   - makes the composition explicit and tree-shakeable
 *
 * Each sub-indicator runs against the same bar, with an independently maintained
 * state slice keyed by SubIndicatorSpec.key.
 *
 * For pipelines where sub-indicator B needs sub-indicator A's output as its input,
 * transform the bar inside deriveOutputs or implement a dedicated builtin instead.
 */

import type {
  IndicatorDefinition,
  IndicatorState,
  IndicatorParameterSchema,
  IndicatorOutputField,
  IndicatorInputSeries,
  BarSeries,
} from "./types";

/** One participating sub-indicator in a composite. */
export interface SubIndicatorSpec {
  /** Key used to store this sub-indicator's state slice in the composite state object. */
  key: string;
  /** Direct reference to the sub-indicator's definition — no registry lookup needed. */
  definition: IndicatorDefinition;
  /**
   * Map the composite's outer params to this sub-indicator's params.
   * If omitted, the sub-indicator receives an empty params object and uses its own defaults.
   */
  params?: (outerParams: Record<string, number | string>) => Record<string, number | string>;
}

/** Declarative spec passed to defineComposite(). */
export interface CompositeIndicatorSpec {
  id: string;
  name: string;
  category: IndicatorDefinition["category"];
  description: string;
  inputs: IndicatorInputSeries[];
  parameters: IndicatorParameterSchema[];
  outputs: IndicatorOutputField[];
  subIndicators: SubIndicatorSpec[];
  /**
   * Derive the composite's final outputs from the collected sub-indicator outputs.
   * Receives the current bar so derived values can reference raw OHLCV fields.
   */
  deriveOutputs: (
    subOutputs: Record<string, Record<string, number | null>>,
    params: Record<string, number | string>,
    bar: BarSeries,
  ) => Record<string, number | null>;
  /**
   * Override auto-computed warmup.
   * Defaults to the max warmup across all sub-indicators.
   */
  warmupBars?: (params: Record<string, number | string>) => number;
}

/**
 * Turn a CompositeIndicatorSpec into a full IndicatorDefinition.
 *
 * The returned definition is a plain IndicatorDefinition — it can be registered
 * in the registry, used as a sub-indicator inside another composite, or tested
 * independently without any registry dependency.
 */
export function defineComposite(spec: CompositeIndicatorSpec): IndicatorDefinition {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    inputs: spec.inputs,
    parameters: spec.parameters,
    outputs: spec.outputs,

    warmupBars(outerParams) {
      if (spec.warmupBars) return spec.warmupBars(outerParams);
      // Default: max warmup across sub-indicators with their mapped params
      let max = 0;
      for (const sub of spec.subIndicators) {
        const subParams = sub.params ? sub.params(outerParams) : {};
        max = Math.max(max, sub.definition.warmupBars(subParams));
      }
      return max;
    },

    createState(outerParams) {
      const subStates: Record<string, unknown> = {};
      for (const sub of spec.subIndicators) {
        const subParams = sub.params ? sub.params(outerParams) : {};
        subStates[sub.key] = sub.definition.createState(subParams);
      }
      return subStates;
    },

    step({ bar, params, state }) {
      const subStates = state as Record<string, IndicatorState>;
      const nextSubStates: Record<string, unknown> = {};
      const subOutputs: Record<string, Record<string, number | null>> = {};

      for (const sub of spec.subIndicators) {
        const subParams = sub.params ? sub.params(params) : {};
        const subState = (subStates[sub.key] ?? sub.definition.createState(subParams)) as IndicatorState;
        const result = sub.definition.step({ bar, params: subParams, state: subState });
        nextSubStates[sub.key] = result.nextState;
        subOutputs[sub.key] = result.outputs;
      }

      const outputs = spec.deriveOutputs(subOutputs, params, bar);
      return { outputs, nextState: nextSubStates };
    },
  };
}
