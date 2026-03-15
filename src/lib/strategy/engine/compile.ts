/**
 * Graph compilation: validate, topo-sort, and resolve input slots.
 *
 * Returns a plain-object ExecutableGraph (no Maps) so it can be
 * cached or serialized freely.
 */

import type { StrategyGraph, StrategyNode, StrategyEdge, NodeType } from "../graphTypes";
import { ACTION_NODE_TYPES } from "../graphTypes";
import type { ExecutableGraph, CompiledNode, CompiledInput, CompileResult, CompileError } from "./types";

// ── Input requirements per node type ─────────────────────────

const REQUIRED_INPUTS: Partial<Record<NodeType, { min: number; desc: string }>> = {
  compare: { min: 1, desc: "at least one numeric input (left)" },
  cross:   { min: 2, desc: "two series inputs (a, b)" },
  and:     { min: 1, desc: "at least one boolean input" },
  or:      { min: 1, desc: "at least one boolean input" },
  not:     { min: 1, desc: "one boolean input" },
  open_position:  { min: 1, desc: "one boolean trigger" },
  close_position: { min: 1, desc: "one boolean trigger" },
  set_risk:       { min: 1, desc: "one boolean trigger" },
};

// ── Public API ───────────────────────────────────────────────

export function compileGraph(graph: StrategyGraph): CompileResult {
  const errors: CompileError[] = [];

  // Build lookup
  const nodeMap = new Map<string, StrategyNode>();
  for (const n of graph.nodes) {
    if (nodeMap.has(n.id)) {
      errors.push({ nodeId: n.id, message: `Duplicate node id "${n.id}"` });
    }
    nodeMap.set(n.id, n);
  }

  // Validate edge endpoints exist
  for (const e of graph.edges) {
    if (!nodeMap.has(e.source)) {
      errors.push({ message: `Edge "${e.id}" references missing source "${e.source}"` });
    }
    if (!nodeMap.has(e.target)) {
      errors.push({ message: `Edge "${e.id}" references missing target "${e.target}"` });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build adjacency & incoming edges per node
  const incomingMap = new Map<string, CompiledInput[]>();
  for (const n of graph.nodes) incomingMap.set(n.id, []);

  for (const e of graph.edges) {
    incomingMap.get(e.target)!.push({
      sourceId: e.source,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      edgeId: e.id,
    });
  }

  // Sort incoming edges deterministically: by targetHandle first, then edgeId
  for (const [, inputs] of incomingMap) {
    inputs.sort((a, b) => {
      const ha = a.targetHandle ?? "";
      const hb = b.targetHandle ?? "";
      if (ha !== hb) return ha.localeCompare(hb);
      return a.edgeId.localeCompare(b.edgeId);
    });
  }

  // Topological sort (Kahn's)
  const order = topoSort(graph.nodes, graph.edges);
  if (order.length !== graph.nodes.length) {
    errors.push({ message: "Graph contains a cycle — strategy must be a DAG" });
    return { ok: false, errors };
  }

  // Validate required inputs
  for (const n of graph.nodes) {
    const req = REQUIRED_INPUTS[n.type as NodeType];
    if (req) {
      const count = incomingMap.get(n.id)!.length;
      if (count < req.min) {
        errors.push({
          nodeId: n.id,
          message: `Node "${n.id}" (${n.type}) requires ${req.desc}, but has ${count} input(s)`,
        });
      }
    }
  }

  // Special: compare with rightType="series" needs 2 inputs
  for (const n of graph.nodes) {
    if (n.type === "compare") {
      const data = n.data as Record<string, unknown>;
      if (data.rightType === "series") {
        const count = incomingMap.get(n.id)!.length;
        if (count < 2) {
          errors.push({
            nodeId: n.id,
            message: `Compare node "${n.id}" with rightType="series" needs 2 inputs (left + right), has ${count}`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build compiled nodes
  const nodes: Record<string, CompiledNode> = {};
  const actionNodeIds: string[] = [];

  for (const n of graph.nodes) {
    nodes[n.id] = {
      id: n.id,
      type: n.type,
      data: n.data as Record<string, unknown>,
      inputs: incomingMap.get(n.id)!,
    };
    if (ACTION_NODE_TYPES.includes(n.type as NodeType)) {
      actionNodeIds.push(n.id);
    }
  }

  return {
    ok: true,
    value: { order, nodes, actionNodeIds },
  };
}

// ── Topological sort (Kahn's, deterministic) ─────────────────

function topoSort(nodes: StrategyNode[], edges: StrategyEdge[]): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.source)!.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // Priority queue sorted alphabetically for determinism
  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const nb of adj.get(id)!) {
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
