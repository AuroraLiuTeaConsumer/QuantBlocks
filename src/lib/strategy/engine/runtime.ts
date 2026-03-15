/**
 * Engine runtime: evaluate one bar through the compiled graph.
 *
 * Pure function — no side effects, no DB.
 * Returns raw actions; use applyActions() to update trading state.
 */

import type {
  Bar,
  ExecutableGraph,
  CompiledNode,
  CompiledInput,
  EngineState,
  Action,
  StepResult,
} from "./types";
import { createRsiState, stepRsi } from "./indicators/rsi";

// ── Public API ───────────────────────────────────────────────

export function createInitialState(initialEquity: number = 10_000): EngineState {
  return {
    nodeValues: {},
    prevBooleans: {},
    prevSeries: {},
    indicators: { rsi: {} },
    position: null,
    risk: {},
    equity: initialEquity,
    initialEquity,
    realizedPnl: 0,
  };
}

export interface StepOptions {
  trace?: boolean;
}

/**
 * Evaluate one bar. Returns actions + updated state.
 * Does NOT apply actions to position/equity — call applyActions() for that.
 */
export function step(
  exec: ExecutableGraph,
  bar: Bar,
  state: EngineState,
  opts: StepOptions = {},
): StepResult {
  // We operate on a shallow copy to avoid mutating the caller's state
  const s: EngineState = {
    ...state,
    nodeValues: { ...state.nodeValues },
    prevBooleans: { ...state.prevBooleans },
    prevSeries: { ...state.prevSeries },
    indicators: {
      rsi: { ...state.indicators.rsi },
    },
    position: state.position ? { ...state.position } : null,
    risk: { ...state.risk },
  };

  const trace: Record<string, { kind: "number" | "boolean" | "null"; value: unknown }> = {};

  // Evaluate every node in topo order
  for (const nodeId of exec.order) {
    const node = exec.nodes[nodeId];
    const val = evaluateNode(node, bar, s);
    s.nodeValues[nodeId] = val;

    if (opts.trace) {
      trace[nodeId] = {
        kind: val === null ? "null" : typeof val === "boolean" ? "boolean" : "number",
        value: val,
      };
    }
  }

  // Collect triggered actions (edge-trigger: false→true for action nodes)
  const rawActions: Action[] = [];

  for (const nodeId of exec.actionNodeIds) {
    const node = exec.nodes[nodeId];
    const val = s.nodeValues[nodeId];
    if (typeof val !== "boolean" || !val) continue;

    const prev = state.prevBooleans[nodeId] ?? false;
    if (prev) continue; // already true last bar — not a new trigger

    const action = buildAction(node);
    if (action) rawActions.push(action);
  }

  // Snapshot booleans for next bar
  for (const nodeId of exec.order) {
    const v = s.nodeValues[nodeId];
    if (typeof v === "boolean") {
      s.prevBooleans[nodeId] = v;
    }
  }

  // Sort actions deterministically: SET_RISK < CLOSE < OPEN
  const ordered = sortActions(rawActions);

  // Apply actions and risk management
  const { state: appliedState, events } = applyActions(s, ordered, bar);

  return {
    state: appliedState,
    actions: ordered,
    events,
    ...(opts.trace ? { trace } : {}),
  };
}

// ── Node evaluation ──────────────────────────────────────────

function evaluateNode(
  node: CompiledNode,
  bar: Bar,
  state: EngineState,
): number | boolean | null {
  const { type, data, inputs } = node;

  switch (type) {
    // ── Data ───────────────────────────────────────────────
    case "price": {
      const field = (data.field as string) ?? "close";
      switch (field) {
        case "open": return bar.open;
        case "high": return bar.high;
        case "low": return bar.low;
        default: return bar.close;
      }
    }
    case "volume":
      return bar.volume ?? 0;

    case "constant":
      return (data.value as number) ?? 0;

    case "rsi": {
      const period = (data.period as number) ?? 14;
      let rsiState = state.indicators.rsi[node.id];
      if (!rsiState) {
        rsiState = createRsiState(period);
      }
      const { value, nextState } = stepRsi(rsiState, bar.close);
      state.indicators.rsi[node.id] = nextState;
      return value;
    }

    // ── Logic ──────────────────────────────────────────────
    case "compare": {
      const left = getNumericInput(inputs, "left", 0, state);
      let right: number | null;
      if (data.rightType === "series") {
        right = getNumericInput(inputs, "right", 1, state);
      } else {
        right = (data.rightValue as number) ?? getNumericInput(inputs, "right", 1, state);
      }
      if (left === null || right === null) return false;
      return compareOp(data.op as string, left, right);
    }

    case "cross": {
      const aCur = getNumericInput(inputs, "a", 0, state);
      const bCur = getNumericInput(inputs, "b", 1, state);

      const aSourceId = resolveSourceId(inputs, "a", 0);
      const bSourceId = resolveSourceId(inputs, "b", 1);

      const aPrev = aSourceId ? (state.prevSeries[aSourceId] ?? null) : null;
      const bPrev = bSourceId ? (state.prevSeries[bSourceId] ?? null) : null;

      // Store current for next bar
      if (aSourceId) state.prevSeries[aSourceId] = aCur;
      if (bSourceId) state.prevSeries[bSourceId] = bCur;

      if (aCur === null || bCur === null || aPrev === null || bPrev === null) return false;

      if (data.direction === "crossUp") {
        return aPrev <= bPrev && aCur > bCur;
      }
      return aPrev >= bPrev && aCur < bCur; // crossDown
    }

    case "and": {
      const bools = getAllBooleans(inputs, state);
      return bools.length > 0 && bools.every(Boolean);
    }
    case "or": {
      const bools = getAllBooleans(inputs, state);
      return bools.length > 0 && bools.some(Boolean);
    }
    case "not": {
      const b = getFirstBoolean(inputs, state);
      return b === null ? false : !b;
    }

    // ── Action nodes pass through trigger boolean ──────────
    case "open_position":
    case "close_position":
    case "set_risk": {
      const b = getFirstBoolean(inputs, state);
      return b ?? false;
    }

    default:
      return null;
  }
}

// ── Action building ──────────────────────────────────────────

function buildAction(node: CompiledNode): Action | null {
  const { data } = node;
  switch (node.type) {
    case "open_position":
      return {
        type: "OPEN",
        side: (data.side as "long" | "short") ?? "long",
        qty: (data.qty as number) ?? 1,
        sourceNodeId: node.id,
      };
    case "close_position":
      return {
        type: "CLOSE",
        reason: "signal",
        sourceNodeId: node.id,
        exitPrice: 0, // will be set in applyActions
      };
    case "set_risk":
      return {
        type: "SET_RISK",
        slPct: data.slPct as number | undefined,
        tpPct: data.tpPct as number | undefined,
        sourceNodeId: node.id,
      };
    default:
      return null;
  }
}

function sortActions(actions: Action[]): Action[] {
  const priority = { SET_RISK: 0, CLOSE: 1, OPEN: 2 };
  return [...actions].sort((a, b) => priority[a.type] - priority[b.type]);
}

// ── Apply actions + risk management ──────────────────────────

import type { TradeEvent } from "./types";

function applyActions(
  state: EngineState,
  actions: Action[],
  bar: Bar,
): { state: EngineState; events: TradeEvent[] } {
  const s = { ...state };
  const events: TradeEvent[] = [];

  for (const action of actions) {
    switch (action.type) {
      case "SET_RISK": {
        s.risk = {
          slPct: action.slPct ?? s.risk.slPct,
          tpPct: action.tpPct ?? s.risk.tpPct,
        };
        // Apply to current position
        if (s.position) {
          s.position = { ...s.position };
          if (action.slPct != null) {
            s.position.slPrice = computeSlPrice(s.position.side, s.position.entryPrice, action.slPct);
          }
          if (action.tpPct != null) {
            s.position.tpPrice = computeTpPrice(s.position.side, s.position.entryPrice, action.tpPct);
          }
        }
        break;
      }
      case "CLOSE": {
        if (s.position) {
          const exitPrice = bar.close;
          const evt = closePosition(s, exitPrice, bar.timeSec, "signal", action.sourceNodeId);
          events.push(evt);
        }
        break;
      }
      case "OPEN": {
        if (!s.position) {
          const entryPrice = bar.close;
          s.position = {
            side: action.side,
            qty: action.qty,
            entryPrice,
            entryTimeSec: bar.timeSec,
            slPrice: s.risk.slPct != null ? computeSlPrice(action.side, entryPrice, s.risk.slPct) : null,
            tpPrice: s.risk.tpPct != null ? computeTpPrice(action.side, entryPrice, s.risk.tpPct) : null,
          };
          events.push({
            kind: "OPENED",
            side: action.side,
            qty: action.qty,
            entryPrice,
            timeSec: bar.timeSec,
            sourceNodeId: action.sourceNodeId,
          });
        }
        break;
      }
    }
  }

  // Risk auto-close: check SL/TP after signal actions
  if (s.position) {
    const pos = s.position;
    const slHit = pos.slPrice !== null && (
      pos.side === "long" ? bar.low <= pos.slPrice : bar.high >= pos.slPrice
    );
    const tpHit = pos.tpPrice !== null && (
      pos.side === "long" ? bar.high >= pos.tpPrice : bar.low <= pos.tpPrice
    );

    if (slHit && tpHit) {
      // Both hit: SL wins (worst-case assumption)
      const evt = closePosition(s, pos.slPrice!, bar.timeSec, "stopLoss");
      events.push(evt);
    } else if (slHit) {
      const evt = closePosition(s, pos.slPrice!, bar.timeSec, "stopLoss");
      events.push(evt);
    } else if (tpHit) {
      const evt = closePosition(s, pos.tpPrice!, bar.timeSec, "takeProfit");
      events.push(evt);
    }
  }

  // Update unrealized PnL
  if (s.position) {
    const diff = bar.close - s.position.entryPrice;
    const dir = s.position.side === "long" ? 1 : -1;
    s.equity = s.initialEquity + s.realizedPnl + diff * dir * s.position.qty;
  } else {
    s.equity = s.initialEquity + s.realizedPnl;
  }

  return { state: s, events };
}

function closePosition(
  state: EngineState,
  exitPrice: number,
  timeSec: number,
  reason: "signal" | "stopLoss" | "takeProfit" | "endOfRun",
  sourceNodeId?: string,
): TradeEvent {
  const pos = state.position!;
  const raw = pos.side === "long"
    ? (exitPrice - pos.entryPrice) * pos.qty
    : (pos.entryPrice - exitPrice) * pos.qty;
  const pnl = Math.round(raw * 10000) / 10000;

  state.realizedPnl = Math.round((state.realizedPnl + pnl) * 10000) / 10000;
  state.position = null;

  return {
    kind: "CLOSED",
    side: pos.side,
    qty: pos.qty,
    entryPrice: pos.entryPrice,
    exitPrice,
    pnl,
    timeSec,
    entryTimeSec: pos.entryTimeSec,
    reason,
    sourceNodeId,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function computeSlPrice(side: "long" | "short", entry: number, slPct: number): number {
  return side === "long"
    ? entry * (1 - slPct / 100)
    : entry * (1 + slPct / 100);
}

function computeTpPrice(side: "long" | "short", entry: number, tpPct: number): number {
  return side === "long"
    ? entry * (1 + tpPct / 100)
    : entry * (1 - tpPct / 100);
}

function getNumericInput(
  inputs: CompiledInput[],
  handle: string,
  positionalIdx: number,
  state: EngineState,
): number | null {
  const edge = inputs.find((e) => e.targetHandle === handle) ?? inputs[positionalIdx];
  if (!edge) return null;
  const v = state.nodeValues[edge.sourceId];
  return typeof v === "number" ? v : null;
}

function resolveSourceId(
  inputs: CompiledInput[],
  handle: string,
  positionalIdx: number,
): string | undefined {
  const edge = inputs.find((e) => e.targetHandle === handle) ?? inputs[positionalIdx];
  return edge?.sourceId;
}

function getAllBooleans(inputs: CompiledInput[], state: EngineState): boolean[] {
  return inputs
    .map((e) => state.nodeValues[e.sourceId])
    .filter((v): v is boolean => typeof v === "boolean");
}

function getFirstBoolean(inputs: CompiledInput[], state: EngineState): boolean | null {
  for (const e of inputs) {
    const v = state.nodeValues[e.sourceId];
    if (typeof v === "boolean") return v;
  }
  return null;
}

function compareOp(op: string, left: number, right: number): boolean {
  switch (op) {
    case ">":  return left > right;
    case "<":  return left < right;
    case ">=": return left >= right;
    case "<=": return left <= right;
    case "==": return left === right;
    default:   return false;
  }
}

/**
 * Force-close any open position (for end-of-backtest / session stop).
 */
export function forceClose(
  state: EngineState,
  bar: Bar,
): { state: EngineState; event: TradeEvent | null } {
  if (!state.position) return { state, event: null };
  const s = { ...state };
  const evt = closePosition(s, bar.close, bar.timeSec, "endOfRun");
  s.equity = s.initialEquity + s.realizedPnl;
  return { state: s, event: evt };
}
