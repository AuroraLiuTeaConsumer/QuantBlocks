import {
  StrategyGraphSchema,
  NodeDataSchemas,
  DATA_NODE_TYPES,
  type NodeType,
  type StrategyNode,
  type StrategyEdge,
} from "./graphTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateGraph(graph: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Schema validation
  const parsed = StrategyGraphSchema.safeParse(graph);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({
        code: "SCHEMA_ERROR",
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }

  const { nodes, edges } = parsed.data;

  // 2. Unique node IDs + validate per-type data
  const nodeMap = new Map<string, StrategyNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodeMap.set(node.id, node);

    const dataSchema = NodeDataSchemas[node.type];
    const dataResult = dataSchema.safeParse(node.data);
    if (!dataResult.success) {
      errors.push({
        code: "INVALID_NODE_DATA",
        message: `Invalid data for node "${node.id}" (${node.type}): ${dataResult.error.issues.map((i) => i.message).join(", ")}`,
        nodeId: node.id,
      });
    }
  }

  // 3. Required nodes (SPEC §7.3)
  const hasOpenPosition = nodes.some((n) => n.type === "open_position");
  const hasClosePosition = nodes.some((n) => n.type === "close_position");
  const hasSetRisk = nodes.some((n) => n.type === "set_risk");

  if (!hasOpenPosition) {
    errors.push({
      code: "MISSING_OPEN_POSITION",
      message: "Graph must contain at least one open_position node",
    });
  }
  if (!hasClosePosition && !hasSetRisk) {
    errors.push({
      code: "MISSING_EXIT",
      message: "Graph must contain at least one close_position or set_risk node",
    });
  }

  // 4. Edge references valid
  for (const edge of edges) {
    if (!nodeMap.has(edge.source)) {
      errors.push({
        code: "INVALID_EDGE_SOURCE",
        message: `Edge "${edge.id}" references non-existent source "${edge.source}"`,
        edgeId: edge.id,
      });
    }
    if (!nodeMap.has(edge.target)) {
      errors.push({
        code: "INVALID_EDGE_TARGET",
        message: `Edge "${edge.id}" references non-existent target "${edge.target}"`,
        edgeId: edge.id,
      });
    }
  }

  // 5. DAG — no cycles
  if (detectCycle(nodes, edges)) {
    errors.push({
      code: "CYCLE_DETECTED",
      message: "Graph contains a cycle; only DAGs are allowed",
    });
  }

  // 6. Connection patterns (SPEC §7.4)
  // Source-only nodes (price, volume, constant) must not have incoming edges.
  // RSI also has no graph inputs in MVP — it reads candle data directly.
  const sourceOnlyTypes: NodeType[] = [...DATA_NODE_TYPES];
  for (const edge of edges) {
    const target = nodeMap.get(edge.target);
    if (target && sourceOnlyTypes.includes(target.type as NodeType)) {
      errors.push({
        code: "INVALID_CONNECTION",
        message: `Node "${target.id}" (${target.type}) must not have incoming edges`,
        edgeId: edge.id,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Cycle detection — DFS with recursion stack
// ---------------------------------------------------------------------------

function detectCycle(nodes: StrategyNode[], edges: StrategyEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    visited.add(id);
    inStack.add(id);
    for (const nb of adj.get(id) ?? []) {
      if (!visited.has(nb)) {
        if (dfs(nb)) return true;
      } else if (inStack.has(nb)) {
        return true;
      }
    }
    inStack.delete(id);
    return false;
  }

  for (const n of nodes) {
    if (!visited.has(n.id) && dfs(n.id)) return true;
  }
  return false;
}
