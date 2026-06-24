import type {
  StrategyDraft,
  StrategyDraftCondition,
  StrategyDraftRiskRule,
} from "@/types/ai-builder";
import type { StrategyGraph, StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const X_DATA = 0;
const X_LOGIC = 280;
const X_AGGREGATE = 560;
const X_ACTION = 840;
const Y_STEP = 160;

// ---------------------------------------------------------------------------
// Indicator name → registry ID mapping
// ---------------------------------------------------------------------------

const NAME_TO_ID: Record<string, string> = {
  RSI: "rsi",
  SMA: "sma",
  EMA: "ema",
  WMA: "wma",
  MACD: "macd",
  BOLLINGER: "bollinger",
  BB: "bollinger",
  "BOLLINGER BANDS": "bollinger",
  ATR: "atr",
  VWAP: "vwap",
  STOCHASTIC: "stochastic",
  STOCH: "stochastic",
  OBV: "obv",
  ADX: "adx",
  DONCHIAN: "donchian",
  KELTNER: "keltner",
  SUPERTREND: "supertrend",
  CCI: "cci",
  ROC: "roc",
  MOMENTUM: "momentum",
  MOM: "momentum",
  PREV_HL: "prev_hl",
  "PREV HL": "prev_hl",
  ELDER_RAY: "elder_ray",
  "ELDER RAY": "elder_ray",
};

function nameToIndicatorId(name: string): string {
  return NAME_TO_ID[name.trim().toUpperCase()] ?? name.toLowerCase().replace(/[\s-]+/g, "_");
}

// Single-output indicator nodes expose handle id "out" (IndicatorNode.tsx line 147).
// Multi-output nodes expose each output field name as its own handle.
const MULTI_OUTPUT_DEFAULT_HANDLE: Record<string, string> = {
  bollinger: "middle",
  macd: "macdLine",
  adx: "adx",
  stochastic: "k",
  donchian: "middle",
  keltner: "middle",
  supertrend: "supertrend",
  prev_hl: "high",
  elder_ray: "bullPower",
};

function indicatorSourceHandle(id: string): string {
  return MULTI_OUTPUT_DEFAULT_HANDLE[id] ?? "out";
}

// Sensible default params per indicator (used when draft doesn't specify params)
function defaultIndicatorParams(name: string): Record<string, number | string> {
  switch (name.toUpperCase()) {
    case "MACD": return { fast: 12, slow: 26, signal: 9 };
    case "BOLLINGER": case "BB": return { period: 20, stdDev: 2 };
    case "STOCHASTIC": case "STOCH": return { kPeriod: 14, dPeriod: 3 };
    case "ATR": case "ADX": return { period: 14 };
    case "SUPERTREND": return { period: 10, multiplier: 3 };
    case "KELTNER": return { period: 20, multiplier: 2 };
    case "DONCHIAN": return { period: 20 };
    case "CCI": return { period: 20 };
    case "PREV_HL": case "PREV HL": return { lookback: 1 };
    default: return { period: 20 };
  }
}

function resolveIndicatorParams(
  name: string,
  draft: Record<string, number | string> | undefined
): Record<string, number | string> {
  if (draft && Object.keys(draft).length > 0) return draft;
  return defaultIndicatorParams(name);
}

// ---------------------------------------------------------------------------
// GraphBuilder — mutable accumulator with Y counters
// ---------------------------------------------------------------------------

class GraphBuilder {
  readonly nodes: StrategyNode[] = [];
  readonly edges: StrategyEdge[] = [];
  private nc = 0;
  private ec = 0;
  private _rowY = 0;   // Y allocated for data/logic column conditions
  private _actionY = 0; // Y for action column

  id(): string { return `n${++this.nc}`; }
  eid(): string { return `e${++this.ec}`; }

  allocateRow(): number {
    const y = this._rowY;
    this._rowY += Y_STEP;
    return y;
  }

  peekRowY(): number { return this._rowY; }

  nextActionY(): number {
    const y = this._actionY;
    this._actionY += Y_STEP;
    return y;
  }

  addNode(node: StrategyNode): string {
    this.nodes.push(node);
    return node.id;
  }

  addEdge(
    source: string,
    target: string,
    sourceHandle?: string,
    targetHandle?: string
  ): void {
    const e: StrategyEdge = { id: this.eid(), source, target };
    if (sourceHandle) e.sourceHandle = sourceHandle;
    if (targetHandle) e.targetHandle = targetHandle;
    this.edges.push(e);
  }

  build(): StrategyGraph { return { nodes: this.nodes, edges: this.edges }; }
}

// ---------------------------------------------------------------------------
// Per-condition chain builders
// ---------------------------------------------------------------------------

type ChainResult = { outputNodeId: string };

function buildIndicatorThreshold(
  cond: StrategyDraftCondition,
  b: GraphBuilder,
  warnings: string[]
): ChainResult {
  const rowY = b.allocateRow();
  const name = (cond.indicator ?? "RSI").trim();
  const op = (cond.comparator ?? ">") as ">" | "<" | ">=" | "<=" | "==";
  const rightValue = typeof cond.threshold === "number" ? cond.threshold : 50;

  if (cond.threshold == null) {
    warnings.push(`No threshold for "${cond.description}" — defaulted to 50`);
  }

  let dataId: string;
  let srcHandle: string | undefined;

  if (name.toUpperCase() === "RSI") {
    // Prefer the dedicated rsi node type
    const period = typeof cond.params?.period === "number" ? cond.params.period : 14;
    dataId = b.id();
    b.addNode({ id: dataId, type: "rsi", position: { x: X_DATA, y: rowY }, data: { period } });
  } else {
    const indicatorId = nameToIndicatorId(name);
    const params = resolveIndicatorParams(name, cond.params as Record<string, number | string> | undefined);
    dataId = b.id();
    b.addNode({
      id: dataId,
      type: "indicator",
      position: { x: X_DATA, y: rowY },
      data: { indicatorId, params, indicatorName: name },
    });
    srcHandle = indicatorSourceHandle(indicatorId);
  }

  const cmpId = b.id();
  b.addNode({
    id: cmpId,
    type: "compare",
    position: { x: X_LOGIC, y: rowY },
    data: { op, rightType: "number", rightValue },
  });
  b.addEdge(dataId, cmpId, srcHandle);

  return { outputNodeId: cmpId };
}

function buildPriceLevel(cond: StrategyDraftCondition, b: GraphBuilder): ChainResult {
  const rowY = b.allocateRow();
  const op = (cond.comparator ?? ">") as ">" | "<" | ">=" | "<=" | "==";
  const rightValue = typeof cond.threshold === "number" ? cond.threshold : 0;

  const priceId = b.id();
  b.addNode({ id: priceId, type: "price", position: { x: X_DATA, y: rowY }, data: { field: "close" } });

  const cmpId = b.id();
  b.addNode({
    id: cmpId,
    type: "compare",
    position: { x: X_LOGIC, y: rowY },
    data: { op, rightType: "number", rightValue },
  });
  b.addEdge(priceId, cmpId);

  return { outputNodeId: cmpId };
}

function buildCrossover(
  cond: StrategyDraftCondition,
  b: GraphBuilder,
  warnings: string[]
): ChainResult {
  const rowA = b.allocateRow(); // fast series (price)
  const rowB = b.allocateRow(); // slow series (indicator)
  const crossY = Math.round((rowA + rowB) / 2);

  const name = (cond.indicator ?? "SMA").trim();
  const indicatorId = nameToIndicatorId(name);
  const params = resolveIndicatorParams(name, cond.params as Record<string, number | string> | undefined);

  const priceId = b.id();
  b.addNode({ id: priceId, type: "price", position: { x: X_DATA, y: rowA }, data: { field: "close" } });

  const indId = b.id();
  b.addNode({
    id: indId,
    type: "indicator",
    position: { x: X_DATA, y: rowB },
    data: { indicatorId, params, indicatorName: name },
  });
  const srcHandle = indicatorSourceHandle(indicatorId);

  // comparator ">" → price crosses above indicator = crossUp
  const direction = cond.comparator === "<" ? "crossDown" : "crossUp";

  const crossId = b.id();
  b.addNode({ id: crossId, type: "cross", position: { x: X_LOGIC, y: crossY }, data: { direction } });
  b.addEdge(priceId, crossId, undefined, "a");
  b.addEdge(indId, crossId, srcHandle, "b");

  return { outputNodeId: crossId };
}

function buildVolumeSpike(
  cond: StrategyDraftCondition,
  b: GraphBuilder,
  warnings: string[]
): ChainResult {
  const rowY = b.allocateRow();

  if (cond.thresholdType === "indicator_multiple") {
    warnings.push(
      `Volume condition "${cond.description}" uses a fixed threshold — dynamic average comparison requires manual canvas adjustment`
    );
  }

  const rightValue = typeof cond.threshold === "number" ? cond.threshold : 1_000_000;

  const volId = b.id();
  b.addNode({ id: volId, type: "volume", position: { x: X_DATA, y: rowY }, data: {} });

  const cmpId = b.id();
  b.addNode({
    id: cmpId,
    type: "compare",
    position: { x: X_LOGIC, y: rowY },
    data: { op: ">", rightType: "number", rightValue },
  });
  b.addEdge(volId, cmpId);

  return { outputNodeId: cmpId };
}

function buildConditionChain(
  cond: StrategyDraftCondition,
  b: GraphBuilder,
  warnings: string[]
): ChainResult | null {
  switch (cond.type) {
    case "indicator_threshold":
      return buildIndicatorThreshold(cond, b, warnings);
    case "price_level":
      return buildPriceLevel(cond, b);
    case "crossover":
      return buildCrossover(cond, b, warnings);
    case "volume_spike":
      return buildVolumeSpike(cond, b, warnings);
    case "custom":
      if (cond.indicator && cond.comparator) {
        return buildIndicatorThreshold(cond, b, warnings);
      }
      warnings.push(
        `Custom condition "${cond.description}" could not be auto-converted — add it manually on the canvas`
      );
      return null;
    default:
      warnings.push(`Unknown condition type — skipped: "${cond.description}"`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Risk rule → set_risk data
// ---------------------------------------------------------------------------

function buildRiskNodeData(
  riskRules: StrategyDraftRiskRule,
  warnings: string[]
): { slPct?: number; tpPct?: number } | null {
  const data: { slPct?: number; tpPct?: number } = {};

  const sl = riskRules.stopLoss;
  if (sl) {
    if (sl.type === "pct" && sl.value != null) {
      data.slPct = sl.value;
    } else if (sl.type === "candle_low") {
      data.slPct = 2;
      warnings.push('Stop loss "below candle low" not directly supported — using 2% as default. Adjust on canvas.');
    } else if (sl.type === "atr" && sl.value != null) {
      data.slPct = sl.value * 1.5; // rough ATR ≈ 1.5%/unit approximation
      warnings.push(
        `Stop loss "${sl.value}×ATR" approximated as ${data.slPct}%. Adjust on canvas after backtesting.`
      );
    }
  }

  const tp = riskRules.takeProfit;
  if (tp) {
    if (tp.type === "pct" && tp.value != null) {
      data.tpPct = tp.value;
    } else if (tp.type === "rr_ratio" && tp.value != null) {
      const slBase = data.slPct ?? 2;
      data.tpPct = tp.value * slBase;
      if (!data.slPct) {
        warnings.push(
          `Take profit R:R computed using default 2% SL base — adjust if stop loss differs.`
        );
      }
    } else if (tp.type === "atr" && tp.value != null) {
      data.tpPct = tp.value * 1.5;
      warnings.push(
        `Take profit "${tp.value}×ATR" approximated as ${data.tpPct}%. Adjust on canvas.`
      );
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export type DraftToGraphResult = {
  graph: StrategyGraph;
  warnings: string[];
};

export function draftToStrategyGraph(draft: StrategyDraft): DraftToGraphResult {
  const b = new GraphBuilder();
  const warnings: string[] = [...draft.warnings];

  // ── Entry conditions ──────────────────────────────────────────────────────
  const entryRowsStart = b.peekRowY();
  const entryOutputIds: string[] = [];

  for (const cond of draft.entryConditions) {
    const r = buildConditionChain(cond, b, warnings);
    if (r) entryOutputIds.push(r.outputNodeId);
  }

  // ── Confirmation conditions (merged with entry AND) ───────────────────────
  const confirmOutputIds: string[] = [];
  for (const cond of draft.confirmationConditions) {
    const r = buildConditionChain(cond, b, warnings);
    if (r) confirmOutputIds.push(r.outputNodeId);
  }

  const allEntryIds = [...entryOutputIds, ...confirmOutputIds];
  const entryLastRowY = Math.max(b.peekRowY() - Y_STEP, entryRowsStart);
  const entryCenterY = Math.round((entryRowsStart + entryLastRowY) / 2);

  // ── Entry gate (AND if multiple) ──────────────────────────────────────────
  let entryGateId: string;

  if (allEntryIds.length === 0) {
    // Fallback — nothing converted: placeholder price compare
    warnings.push("No entry conditions could be converted — placeholder price node added");
    const rowY = b.allocateRow();
    const pid = b.id();
    b.addNode({ id: pid, type: "price", position: { x: X_DATA, y: rowY }, data: { field: "close" } });
    const cid = b.id();
    b.addNode({ id: cid, type: "compare", position: { x: X_LOGIC, y: rowY }, data: { op: ">", rightType: "number", rightValue: 0 } });
    b.addEdge(pid, cid);
    entryGateId = cid;
  } else if (allEntryIds.length === 1) {
    entryGateId = allEntryIds[0];
  } else {
    const andId = b.id();
    b.addNode({ id: andId, type: "and", position: { x: X_AGGREGATE, y: entryCenterY }, data: {} });
    for (const src of allEntryIds) b.addEdge(src, andId);
    entryGateId = andId;
  }

  // ── Open position ─────────────────────────────────────────────────────────
  const side = draft.direction === "short" ? "short" : "long";
  const openId = b.id();
  b.addNode({
    id: openId,
    type: "open_position",
    position: { x: X_ACTION, y: b.nextActionY() },
    data: { side, qtyType: "fixed", qty: 1 },
  });
  b.addEdge(entryGateId, openId);

  if (draft.direction === "both") {
    warnings.push(
      'Direction "both" — generated long side only. Add a short open_position node for the opposite leg.'
    );
  }

  // ── Set risk ──────────────────────────────────────────────────────────────
  if (draft.riskRules) {
    const riskData = buildRiskNodeData(draft.riskRules, warnings);
    if (riskData) {
      const riskId = b.id();
      b.addNode({
        id: riskId,
        type: "set_risk",
        position: { x: X_ACTION, y: b.nextActionY() },
        data: riskData,
      });
      b.addEdge(entryGateId, riskId);
    }
  }

  // ── Exit conditions → close_position ─────────────────────────────────────
  const exitRowsStart = b.peekRowY();
  const exitOutputIds: string[] = [];

  for (const cond of draft.exitConditions) {
    const r = buildConditionChain(cond, b, warnings);
    if (r) exitOutputIds.push(r.outputNodeId);
  }

  if (exitOutputIds.length > 0) {
    const exitLastRowY = Math.max(b.peekRowY() - Y_STEP, exitRowsStart);
    const exitCenterY = Math.round((exitRowsStart + exitLastRowY) / 2);

    let exitGateId: string;
    if (exitOutputIds.length === 1) {
      exitGateId = exitOutputIds[0];
    } else {
      const orId = b.id();
      b.addNode({ id: orId, type: "or", position: { x: X_AGGREGATE, y: exitCenterY }, data: {} });
      for (const src of exitOutputIds) b.addEdge(src, orId);
      exitGateId = orId;
    }

    const closeId = b.id();
    b.addNode({
      id: closeId,
      type: "close_position",
      position: { x: X_ACTION, y: b.nextActionY() },
      data: {},
    });
    b.addEdge(exitGateId, closeId);
  }

  // ── Ensure at least one exit mechanism (validator requirement) ────────────
  const hasExit =
    b.nodes.some((n) => n.type === "close_position") ||
    b.nodes.some((n) => n.type === "set_risk");

  if (!hasExit) {
    warnings.push("No exit mechanism — added a default 2% stop loss. Adjust on canvas.");
    const riskId = b.id();
    b.addNode({
      id: riskId,
      type: "set_risk",
      position: { x: X_ACTION, y: b.nextActionY() },
      data: { slPct: 2 },
    });
    b.addEdge(entryGateId, riskId);
  }

  return { graph: b.build(), warnings };
}
