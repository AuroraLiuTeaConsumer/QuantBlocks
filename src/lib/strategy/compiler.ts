import type { StrategyGraph, StrategyNode, StrategyEdge, NodeType } from "./graphTypes";

// ---------------------------------------------------------------------------
// Candle type (shared with backtest)
// ---------------------------------------------------------------------------

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Compiled plan
// ---------------------------------------------------------------------------

export interface CompiledPlan {
  /** Node IDs in topological (evaluation) order */
  evaluationOrder: string[];
  /** Node map by ID */
  nodes: Map<string, StrategyNode>;
  /** For each node, the incoming edges grouped by targetHandle */
  inputs: Map<string, IncomingEdge[]>;
}

export interface IncomingEdge {
  sourceId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// ---------------------------------------------------------------------------
// Actions emitted per bar
// ---------------------------------------------------------------------------

export type BarAction =
  | { type: "open_position"; side: "long" | "short"; qty: number; nodeId: string }
  | { type: "close_position"; nodeId: string }
  | { type: "set_risk"; slPct?: number; tpPct?: number; nodeId: string };

// ---------------------------------------------------------------------------
// Evaluator state persisted across bars
// ---------------------------------------------------------------------------

export interface EvaluatorState {
  /** Current numeric/boolean value for every node */
  values: Map<string, number | boolean | null>;
  /** Previous bar boolean values — for edge-triggered detection */
  prevBooleans: Map<string, boolean>;
  /** RSI rolling state per RSI node (Wilder smoothing) */
  rsiAvgGain: Map<string, number>;
  rsiAvgLoss: Map<string, number>;
  rsiInitialized: Map<string, boolean>;
  /** Previous series values per node — for cross detection */
  prevSeries: Map<string, number | null>;
}

// ---------------------------------------------------------------------------
// Compile graph → plan
// ---------------------------------------------------------------------------

export function compilePlan(graph: StrategyGraph): CompiledPlan {
  const nodeMap = new Map<string, StrategyNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);

  const inputs = new Map<string, IncomingEdge[]>();
  for (const n of graph.nodes) inputs.set(n.id, []);
  for (const e of graph.edges) {
    inputs.get(e.target)?.push({
      sourceId: e.source,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    });
  }

  const evaluationOrder = topologicalSort(graph.nodes, graph.edges);

  return { evaluationOrder, nodes: nodeMap, inputs };
}

// ---------------------------------------------------------------------------
// Create fresh evaluator state
// ---------------------------------------------------------------------------

export function createInitialState(): EvaluatorState {
  return {
    values: new Map(),
    prevBooleans: new Map(),
    rsiAvgGain: new Map(),
    rsiAvgLoss: new Map(),
    rsiInitialized: new Map(),
    prevSeries: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Evaluate one bar — returns triggered actions
// ---------------------------------------------------------------------------

export function evaluateBar(
  plan: CompiledPlan,
  state: EvaluatorState,
  candles: Candle[],
  barIndex: number,
): BarAction[] {
  const candle = candles[barIndex];
  const actions: BarAction[] = [];

  for (const nodeId of plan.evaluationOrder) {
    const node = plan.nodes.get(nodeId)!;
    const incoming = plan.inputs.get(nodeId) ?? [];

    const val = evaluateNode(node, incoming, state, candles, barIndex, candle);
    state.values.set(nodeId, val);

    // For action nodes: detect false→true edge trigger
    if (isActionType(node.type as NodeType) && typeof val === "boolean") {
      const prev = state.prevBooleans.get(nodeId) ?? false;
      if (val && !prev) {
        const action = buildAction(node);
        if (action) actions.push(action);
      }
    }
  }

  // Snapshot booleans for next bar edge-detection
  for (const nodeId of plan.evaluationOrder) {
    const v = state.values.get(nodeId);
    if (typeof v === "boolean") {
      state.prevBooleans.set(nodeId, v);
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Per-node evaluation
// ---------------------------------------------------------------------------

function evaluateNode(
  node: StrategyNode,
  incoming: IncomingEdge[],
  state: EvaluatorState,
  candles: Candle[],
  barIndex: number,
  candle: Candle,
): number | boolean | null {
  const data = node.data as Record<string, unknown>;
  const type = node.type as NodeType;

  switch (type) {
    // --- Data nodes ---
    case "price": {
      const field = (data.field as string) ?? "close";
      return candle[field as keyof Candle] as number;
    }
    case "volume":
      return candle.volume;
    case "constant":
      return (data.value as number) ?? 0;
    case "rsi":
      return computeRSI(node.id, state, candles, barIndex, (data.period as number) ?? 14);

    // --- Logic nodes ---
    case "compare": {
      const left = getInputValue(incoming, "left", state);
      let right: number | null;
      if ((data.rightType as string) === "series") {
        right = getInputValue(incoming, "right", state) as number | null;
      } else {
        right = (data.rightValue as number) ?? (getInputValue(incoming, "right", state) as number | null);
      }
      if (left === null || right === null) return false;
      return compareOp(data.op as string, left as number, right as number);
    }
    case "cross": {
      const aCur = getInputValue(incoming, "a", state) as number | null;
      const bCur = getInputValue(incoming, "b", state) as number | null;
      const aPrev = state.prevSeries.get(inputSourceId(incoming, "a") ?? "") ?? null;
      const bPrev = state.prevSeries.get(inputSourceId(incoming, "b") ?? "") ?? null;

      // Snapshot current series for next bar
      if (inputSourceId(incoming, "a")) {
        state.prevSeries.set(inputSourceId(incoming, "a")!, aCur);
      }
      if (inputSourceId(incoming, "b")) {
        state.prevSeries.set(inputSourceId(incoming, "b")!, bCur);
      }

      if (aCur === null || bCur === null || aPrev === null || bPrev === null) return false;
      if ((data.direction as string) === "crossUp") {
        return aPrev <= bPrev && aCur > bCur;
      }
      return aPrev >= bPrev && aCur < bCur; // crossDown
    }
    case "and": {
      const bools = getAllInputBooleans(incoming, state);
      return bools.length > 0 && bools.every(Boolean);
    }
    case "or": {
      const bools = getAllInputBooleans(incoming, state);
      return bools.length > 0 && bools.some(Boolean);
    }
    case "not": {
      const b = getFirstInputBoolean(incoming, state);
      return b === null ? false : !b;
    }

    // --- Action nodes (return trigger boolean from input) ---
    case "open_position":
    case "close_position":
    case "set_risk": {
      const trigger = getFirstInputBoolean(incoming, state);
      return trigger ?? false;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// RSI — Wilder smoothing
// ---------------------------------------------------------------------------

function computeRSI(
  nodeId: string,
  state: EvaluatorState,
  candles: Candle[],
  barIndex: number,
  period: number,
): number | null {
  if (barIndex < 1) return null;

  const change = candles[barIndex].close - candles[barIndex - 1].close;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? Math.abs(change) : 0;

  if (!state.rsiInitialized.get(nodeId)) {
    // Accumulate until we have `period` changes
    const prevGain = state.rsiAvgGain.get(nodeId) ?? 0;
    const prevLoss = state.rsiAvgLoss.get(nodeId) ?? 0;
    state.rsiAvgGain.set(nodeId, prevGain + gain);
    state.rsiAvgLoss.set(nodeId, prevLoss + loss);

    if (barIndex >= period) {
      // Initialize with SMA
      state.rsiAvgGain.set(nodeId, state.rsiAvgGain.get(nodeId)! / period);
      state.rsiAvgLoss.set(nodeId, state.rsiAvgLoss.get(nodeId)! / period);
      state.rsiInitialized.set(nodeId, true);
      const avgGain = state.rsiAvgGain.get(nodeId)!;
      const avgLoss = state.rsiAvgLoss.get(nodeId)!;
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return 100 - 100 / (1 + rs);
    }
    return null; // not enough data yet
  }

  // Wilder smoothing
  const prevAvgGain = state.rsiAvgGain.get(nodeId)!;
  const prevAvgLoss = state.rsiAvgLoss.get(nodeId)!;
  const avgGain = (prevAvgGain * (period - 1) + gain) / period;
  const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
  state.rsiAvgGain.set(nodeId, avgGain);
  state.rsiAvgLoss.set(nodeId, avgLoss);

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInputValue(
  incoming: IncomingEdge[],
  handle: string,
  state: EvaluatorState,
): number | boolean | null {
  // Try matching by targetHandle first, then fall back to positional
  let edge = incoming.find((e) => e.targetHandle === handle);
  if (!edge) {
    // Positional: "left" = first, "right" = second for compare
    // "a" = first, "b" = second for cross
    const idx = handle === "left" || handle === "a" ? 0 : handle === "right" || handle === "b" ? 1 : 0;
    edge = incoming[idx];
  }
  if (!edge) return null;
  return state.values.get(edge.sourceId) ?? null;
}

function inputSourceId(incoming: IncomingEdge[], handle: string): string | undefined {
  let edge = incoming.find((e) => e.targetHandle === handle);
  if (!edge) {
    const idx = handle === "left" || handle === "a" ? 0 : 1;
    edge = incoming[idx];
  }
  return edge?.sourceId;
}

function getAllInputBooleans(incoming: IncomingEdge[], state: EvaluatorState): boolean[] {
  return incoming
    .map((e) => state.values.get(e.sourceId))
    .filter((v): v is boolean => typeof v === "boolean");
}

function getFirstInputBoolean(incoming: IncomingEdge[], state: EvaluatorState): boolean | null {
  for (const e of incoming) {
    const v = state.values.get(e.sourceId);
    if (typeof v === "boolean") return v;
  }
  return null;
}

function compareOp(op: string, left: number, right: number): boolean {
  switch (op) {
    case ">":
      return left > right;
    case "<":
      return left < right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case "==":
      return left === right;
    default:
      return false;
  }
}

function isActionType(type: NodeType): boolean {
  return type === "open_position" || type === "close_position" || type === "set_risk";
}

function buildAction(node: StrategyNode): BarAction | null {
  const data = node.data as Record<string, unknown>;
  switch (node.type) {
    case "open_position":
      return {
        type: "open_position",
        side: (data.side as "long" | "short") ?? "long",
        qty: (data.qty as number) ?? 0.01,
        nodeId: node.id,
      };
    case "close_position":
      return { type: "close_position", nodeId: node.id };
    case "set_risk":
      return {
        type: "set_risk",
        slPct: data.slPct as number | undefined,
        tpPct: data.tpPct as number | undefined,
        nodeId: node.id,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Topological sort — Kahn's algorithm
// ---------------------------------------------------------------------------

function topologicalSort(nodes: StrategyNode[], edges: StrategyEdge[]): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  // Sort queue for determinism (alphabetical)
  queue.sort();

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const nb of adj.get(id) ?? []) {
      const newDeg = (inDeg.get(nb) ?? 1) - 1;
      inDeg.set(nb, newDeg);
      if (newDeg === 0) {
        queue.push(nb);
        queue.sort();
      }
    }
  }

  return sorted;
}
