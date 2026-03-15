/**
 * Shared strategy engine types.
 * All types are plain objects (no Maps) so they can be JSON-serialized
 * for persistence in PaperSession.engineState.
 */

// ── Bar ──────────────────────────────────────────────────────

export interface Bar {
  timeSec: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ── Compiled Graph ───────────────────────────────────────────

export interface CompiledNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  /** Incoming edges sorted by (targetHandle ?? edge.id) for determinism */
  inputs: CompiledInput[];
}

export interface CompiledInput {
  sourceId: string;
  sourceHandle?: string;
  targetHandle?: string;
  edgeId: string;
}

export interface ExecutableGraph {
  /** Node IDs in topological evaluation order */
  order: string[];
  /** Keyed by node ID */
  nodes: Record<string, CompiledNode>;
  /** Pre-extracted action node IDs (subset of order) */
  actionNodeIds: string[];
}

export type CompileResult =
  | { ok: true; value: ExecutableGraph }
  | { ok: false; errors: CompileError[] };

export interface CompileError {
  nodeId?: string;
  message: string;
}

// ── Actions ──────────────────────────────────────────────────

export type Action =
  | { type: "SET_RISK"; slPct?: number; tpPct?: number; sourceNodeId: string }
  | { type: "OPEN"; side: "long" | "short"; qty: number; sourceNodeId: string }
  | { type: "CLOSE"; reason: "signal" | "stopLoss" | "takeProfit"; sourceNodeId?: string; exitPrice: number };

// ── Trade Events (output of applyActions) ────────────────────

export type TradeEvent =
  | {
      kind: "OPENED";
      side: "long" | "short";
      qty: number;
      entryPrice: number;
      timeSec: number;
      sourceNodeId: string;
    }
  | {
      kind: "CLOSED";
      side: "long" | "short";
      qty: number;
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      timeSec: number;
      entryTimeSec: number;
      reason: "signal" | "stopLoss" | "takeProfit" | "endOfRun";
      sourceNodeId?: string;
    };

// ── Engine State (serializable) ──────────────────────────────

export interface EngineState {
  /** Per-node last computed values (number | boolean | null) */
  nodeValues: Record<string, number | boolean | null>;
  /** Previous-bar booleans for edge-trigger detection on action nodes */
  prevBooleans: Record<string, boolean>;
  /** Previous-bar series values for cross detection */
  prevSeries: Record<string, number | null>;
  /** Indicator states keyed by nodeId */
  indicators: {
    rsi: Record<string, RsiState>;
  };
  /** Trading position state */
  position: PositionState | null;
  /** Risk settings currently active */
  risk: { slPct?: number; tpPct?: number };
  /** Accounting */
  equity: number;
  initialEquity: number;
  realizedPnl: number;
}

export interface PositionState {
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimeSec: number;
  slPrice: number | null;
  tpPrice: number | null;
}

export interface RsiState {
  period: number;
  avgGain: number;
  avgLoss: number;
  lastClose: number | null;
  warmupCount: number;
  initialized: boolean;
}

// ── Step result ──────────────────────────────────────────────

export interface StepResult {
  state: EngineState;
  actions: Action[];
  events: TradeEvent[];
  /** Node outputs for this bar (only when trace=true) */
  trace?: Record<string, { kind: "number" | "boolean" | "null"; value: unknown }>;
}
