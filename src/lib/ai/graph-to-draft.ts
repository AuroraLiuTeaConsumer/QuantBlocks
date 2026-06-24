import type { StrategyGraph, StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";
import type {
  StrategyDraft,
  StrategyDraftCondition,
  StrategyDraftRiskRule,
} from "@/types/ai-builder";
import { EMPTY_DRAFT } from "./ai-builder-state";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reverse-engineers a StrategyDraft from an existing StrategyGraph.
 * Used to seed the AI Builder conversation when the user opens the panel
 * with a non-empty canvas, enabling conversational revision.
 *
 * Information loss is expected: confirmation vs entry distinction is gone,
 * NOT gates produce a warning and are skipped, and complex custom conditions
 * can't be fully reconstructed. The draft is good enough for the AI to reason
 * about what exists and what the user wants to change.
 */
export function graphToStrategyDraft(graph: StrategyGraph): StrategyDraft {
  if (graph.nodes.length === 0) return { ...EMPTY_DRAFT };

  // ── Index structures ──────────────────────────────────────────────────────
  const nodeMap = new Map<string, StrategyNode>();
  const reverseAdj = new Map<string, string[]>();          // target → [source ids]
  const incomingEdges = new Map<string, StrategyEdge[]>(); // target → [edges]

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
    reverseAdj.set(node.id, []);
    incomingEdges.set(node.id, []);
  }
  for (const edge of graph.edges) {
    reverseAdj.get(edge.target)?.push(edge.source);
    incomingEdges.get(edge.target)?.push(edge);
  }

  // ── Traverse ──────────────────────────────────────────────────────────────
  const entryConditions: StrategyDraftCondition[] = [];
  const exitConditions: StrategyDraftCondition[] = [];
  let riskRules: StrategyDraftRiskRule | undefined;
  let direction: "long" | "short" | "both" | undefined;
  const warnings: string[] = [];

  const entryVisited = new Set<string>();
  const exitVisited = new Set<string>();

  for (const node of graph.nodes) {
    if (node.type === "open_position") {
      const data = node.data as { side: "long" | "short" };
      direction = direction === undefined
        ? data.side
        : direction !== data.side
          ? "both"
          : direction;

      for (const srcId of reverseAdj.get(node.id) ?? []) {
        collectConditions(srcId, nodeMap, reverseAdj, incomingEdges, entryConditions, entryVisited, warnings);
      }
    }

    if (node.type === "close_position") {
      for (const srcId of reverseAdj.get(node.id) ?? []) {
        collectConditions(srcId, nodeMap, reverseAdj, incomingEdges, exitConditions, exitVisited, warnings);
      }
    }

    if (node.type === "set_risk") {
      const data = node.data as { slPct?: number; tpPct?: number };
      // Merge multiple set_risk nodes — first non-null value for each field wins.
      // Skip empty set_risk nodes (neither field set) to avoid a truthy-but-empty riskRules.
      if (data.slPct != null || data.tpPct != null) {
        riskRules = {
          stopLoss: data.slPct != null ? { type: "pct", value: data.slPct } : riskRules?.stopLoss,
          takeProfit: data.tpPct != null ? { type: "pct", value: data.tpPct } : riskRules?.takeProfit,
        };
      }
    }
  }

  if (entryConditions.length === 0 && exitConditions.length === 0 && !riskRules) {
    warnings.push(
      "Could not extract conditions from the canvas graph. You may need to describe your strategy from scratch."
    );
  }

  return {
    ...EMPTY_DRAFT,
    direction,
    entryConditions,
    exitConditions,
    riskRules,
    assumptions: ["Imported from existing strategy canvas"],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal traversal
// ---------------------------------------------------------------------------

function collectConditions(
  nodeId: string,
  nodeMap: Map<string, StrategyNode>,
  reverseAdj: Map<string, string[]>,
  incomingEdgesMap: Map<string, StrategyEdge[]>,
  out: StrategyDraftCondition[],
  visited: Set<string>,
  warnings: string[]
): void {
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node) return;

  switch (node.type) {
    case "and":
      for (const srcId of reverseAdj.get(nodeId) ?? []) {
        collectConditions(srcId, nodeMap, reverseAdj, incomingEdgesMap, out, visited, warnings);
      }
      break;

    case "or":
      // OR semantics cannot be fully expressed in the draft's flat condition lists.
      // Collect the branches so the AI can see them, but warn about the limitation.
      warnings.push(
        "An OR gate was found — conditions from both branches are listed, but their OR relationship cannot be fully represented in the draft."
      );
      for (const srcId of reverseAdj.get(nodeId) ?? []) {
        collectConditions(srcId, nodeMap, reverseAdj, incomingEdgesMap, out, visited, warnings);
      }
      break;

    case "not":
      warnings.push(
        "A NOT gate was found in the canvas — it could not be imported into the draft. Add it manually after regenerating."
      );
      break;

    case "compare":
    case "cross": {
      const cond = nodeToCondition(nodeId, node, nodeMap, incomingEdgesMap, warnings);
      if (cond) out.push(cond);
      break;
    }

    default:
      break;
  }
}

function nodeToCondition(
  nodeId: string,
  node: StrategyNode,
  nodeMap: Map<string, StrategyNode>,
  incomingEdgesMap: Map<string, StrategyEdge[]>,
  warnings: string[]
): StrategyDraftCondition | null {
  if (node.type === "compare") {
    return buildCompareCondition(nodeId, node, nodeMap, incomingEdgesMap, warnings);
  }
  if (node.type === "cross") {
    return buildCrossCondition(nodeId, node, nodeMap, incomingEdgesMap, warnings);
  }
  return null;
}

function buildCompareCondition(
  nodeId: string,
  node: StrategyNode,
  nodeMap: Map<string, StrategyNode>,
  incomingEdgesMap: Map<string, StrategyEdge[]>,
  warnings: string[]
): StrategyDraftCondition | null {
  const data = node.data as { op: string; rightValue?: number; rightType?: string };
  const op = data.op as StrategyDraftCondition["comparator"];
  const threshold = typeof data.rightValue === "number" ? data.rightValue : undefined;

  const edges = incomingEdgesMap.get(nodeId) ?? [];
  // Resolve left (series) input by handle name; fall back to first edge.
  // Draft-to-graph always produces a single edge with no targetHandle (the left/series side).
  // User-built series-vs-series compares use targetHandle "left" and "right".
  const leftEdge =
    edges.find((e) => e.targetHandle === "left") ??
    edges.find((e) => !e.targetHandle) ??
    edges[0];
  const sourceId = leftEdge?.source;
  const sourceNode = sourceId ? nodeMap.get(sourceId) : undefined;

  if (!sourceNode) {
    return { type: "custom", description: `Unknown ${data.op} ${threshold ?? "?"}` };
  }

  // Series-vs-series compare: right side is another node, not a fixed number.
  if (data.rightType === "series") {
    const rightEdge = edges.find((e) => e.targetHandle === "right");
    const rightNode = rightEdge ? nodeMap.get(rightEdge.source) : undefined;
    const leftDesc = describeSourceNode(sourceNode);
    const rightDesc = rightNode ? describeSourceNode(rightNode) : "another series";
    warnings.push(
      `Series-vs-series compare (${leftDesc} ${op} ${rightDesc}) imported as a custom condition — verify the threshold after import.`
    );
    return {
      type: "custom",
      description: `${leftDesc} ${op} ${rightDesc}`,
      comparator: op,
      thresholdType: "indicator_multiple",
    };
  }

  switch (sourceNode.type) {
    case "rsi": {
      const rsiData = sourceNode.data as { period?: number };
      const period = rsiData.period ?? 14;
      return {
        type: "indicator_threshold",
        description: `RSI(${period}) ${op} ${threshold ?? "?"}`,
        indicator: "RSI",
        params: { period },
        comparator: op,
        threshold,
        thresholdType: "fixed",
      };
    }

    case "indicator": {
      const indData = sourceNode.data as {
        indicatorId: string;
        params?: Record<string, number | string>;
        indicatorName?: string;
      };
      const name = indData.indicatorName ?? indData.indicatorId.toUpperCase();
      const params = indData.params ?? {};
      const paramStr = Object.entries(params)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      return {
        type: "indicator_threshold",
        description: `${name}(${paramStr || "default"}) ${op} ${threshold ?? "?"}`,
        indicator: name,
        params,
        comparator: op,
        threshold,
        thresholdType: "fixed",
      };
    }

    case "price": {
      const priceData = sourceNode.data as { field?: string };
      return {
        type: "price_level",
        description: `Price ${priceData.field ?? "close"} ${op} ${threshold ?? "?"}`,
        comparator: op,
        threshold,
        thresholdType: "fixed",
      };
    }

    case "volume":
      return {
        type: "volume_spike",
        description: `Volume ${op} ${threshold ?? "?"}`,
        comparator: op,
        threshold,
        thresholdType: "fixed",
      };

    default:
      return {
        type: "custom",
        description: `${sourceNode.type} ${op} ${threshold ?? "?"}`,
      };
  }
}

function buildCrossCondition(
  nodeId: string,
  node: StrategyNode,
  nodeMap: Map<string, StrategyNode>,
  incomingEdgesMap: Map<string, StrategyEdge[]>,
  warnings: string[]
): StrategyDraftCondition | null {
  const crossData = node.data as { direction: "crossUp" | "crossDown" };
  const edges = incomingEdgesMap.get(nodeId) ?? [];

  const bEdge = edges.find((e) => e.targetHandle === "b");
  const bSourceNode = bEdge ? nodeMap.get(bEdge.source) : undefined;

  let indName = "SMA";
  let indParams: Record<string, number | string> = { period: 20 };
  let resolved = false;

  if (bSourceNode?.type === "indicator") {
    const d = bSourceNode.data as {
      indicatorId: string;
      params?: Record<string, number | string>;
      indicatorName?: string;
    };
    indName = d.indicatorName ?? d.indicatorId.toUpperCase();
    indParams = d.params ?? {};
    resolved = true;
  } else if (bSourceNode?.type === "rsi") {
    indName = "RSI";
    indParams = { period: (bSourceNode.data as { period?: number }).period ?? 14 };
    resolved = true;
  }

  if (!resolved) {
    warnings.push(
      "A crossover node's indicator input could not be identified — defaulted to SMA(20). Verify after import."
    );
  }

  const direction = crossData.direction === "crossUp" ? "crosses above" : "crosses below";
  const paramStr = Object.entries(indParams)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  return {
    type: "crossover",
    description: `Price ${direction} ${indName}(${paramStr || "default"})`,
    indicator: indName,
    params: indParams,
    comparator: crossData.direction === "crossUp" ? ">" : "<",
  };
}

// Returns a short human-readable label for a source node (used in condition descriptions).
function describeSourceNode(node: StrategyNode): string {
  switch (node.type) {
    case "rsi": {
      const d = node.data as { period?: number };
      return `RSI(${d.period ?? 14})`;
    }
    case "indicator": {
      const d = node.data as { indicatorName?: string; indicatorId?: string };
      return d.indicatorName ?? d.indicatorId?.toUpperCase() ?? "indicator";
    }
    case "price": {
      const d = node.data as { field?: string };
      return `price.${d.field ?? "close"}`;
    }
    case "volume":
      return "volume";
    default:
      return node.type;
  }
}
