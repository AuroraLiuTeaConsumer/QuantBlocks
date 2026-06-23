/**
 * Core indicator system types.
 * All state types are JSON-serializable (no Maps, Sets, or class instances)
 * so they survive the PaperSession.engineState round-trip through Prisma.
 */

/** Bar data exposed to indicator step functions. */
export interface BarSeries {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timeSec: number;
}

/** Which bar field an indicator reads as its primary price input. */
export type IndicatorInputSeries =
  | "close"
  | "open"
  | "high"
  | "low"
  | "volume"
  | "hl2"
  | "hlc3"
  | "ohlc4";

/** Schema for one configurable parameter on an indicator. */
export interface IndicatorParameterSchema {
  name: string;
  type: "integer" | "float" | "select";
  label: string;
  default: number | string;
  min?: number;
  max?: number;
  options?: string[]; // for type === "select"
}

/** Schema for one named output series produced by an indicator. */
export interface IndicatorOutputField {
  name: string;  // used as handle id on the canvas node
  label: string; // display label
  type: "number" | "boolean";
}

/**
 * Opaque, serializable state an indicator carries between bars.
 * Must survive JSON.stringify / JSON.parse intact.
 */
export type IndicatorState = Record<string, unknown>;

/** Outputs + updated state from processing one bar. */
export interface IndicatorCalculationResult {
  /** Keyed by IndicatorOutputField.name. null = still in warmup. */
  outputs: Record<string, number | null>;
  nextState: IndicatorState;
}

/** What the indicator's step function receives. */
export interface IndicatorExecutionContext {
  bar: BarSeries;
  params: Record<string, number | string>;
  state: IndicatorState;
}

/** Complete descriptor for a built-in or custom indicator. */
export interface IndicatorDefinition {
  /** Stable unique ID used in node data and engine state keys. */
  id: string;
  name: string;
  category: "trend" | "momentum" | "volatility" | "volume" | "other";
  description: string;

  inputs: IndicatorInputSeries[];
  parameters: IndicatorParameterSchema[];
  outputs: IndicatorOutputField[];

  /** Number of bars required before the first non-null output. */
  warmupBars: (params: Record<string, number | string>) => number;

  /** Create a blank initial state for a fresh node instance. */
  createState: (params: Record<string, number | string>) => IndicatorState;

  /**
   * Pure step function — must not mutate state or read external data.
   * Returns output values for this bar and the state to carry to the next bar.
   */
  step: (ctx: IndicatorExecutionContext) => IndicatorCalculationResult;

  display?: {
    defaultWidth?: number;
  };
}

/** What the strategy graph's "indicator" node type stores in its data field. */
export interface IndicatorNodeConfig {
  indicatorId: string;
  params: Record<string, number | string>;
  /** Cached display name — used by the UI, ignored by the engine. */
  indicatorName?: string;
}

/** Central registry contract. */
export interface IIndicatorRegistry {
  register(def: IndicatorDefinition): void;
  get(id: string): IndicatorDefinition | undefined;
  getAll(): IndicatorDefinition[];
  getByCategory(category: IndicatorDefinition["category"]): IndicatorDefinition[];
  has(id: string): boolean;
}
