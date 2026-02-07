import { z } from "zod";

// ---------------------------------------------------------------------------
// Node data schemas (per SPEC §7.2)
// ---------------------------------------------------------------------------

export const PriceNodeData = z.object({
  field: z.enum(["close", "open", "high", "low"]).default("close"),
});

export const VolumeNodeData = z.object({});

export const RsiNodeData = z.object({
  period: z.number().int().positive().default(14),
});

export const CompareNodeData = z.object({
  op: z.enum([">", "<", ">=", "<=", "=="]),
  rightType: z.enum(["number", "series"]).default("number"),
  rightValue: z.number().optional(),
});

export const CrossNodeData = z.object({
  direction: z.enum(["crossUp", "crossDown"]),
});

export const AndNodeData = z.object({});
export const OrNodeData = z.object({});
export const NotNodeData = z.object({});

export const ConstantNodeData = z.object({
  value: z.number(),
});

export const OpenPositionNodeData = z.object({
  side: z.enum(["long", "short"]),
  qtyType: z.literal("fixed").default("fixed"),
  qty: z.number().positive(),
});

export const ClosePositionNodeData = z.object({});

export const SetRiskNodeData = z.object({
  slPct: z.number().optional(),
  tpPct: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Allowed node types
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  "price",
  "volume",
  "rsi",
  "compare",
  "cross",
  "and",
  "or",
  "not",
  "constant",
  "open_position",
  "close_position",
  "set_risk",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NodeDataSchemas: Record<NodeType, z.ZodTypeAny> = {
  price: PriceNodeData,
  volume: VolumeNodeData,
  rsi: RsiNodeData,
  compare: CompareNodeData,
  cross: CrossNodeData,
  and: AndNodeData,
  or: OrNodeData,
  not: NotNodeData,
  constant: ConstantNodeData,
  open_position: OpenPositionNodeData,
  close_position: ClosePositionNodeData,
  set_risk: SetRiskNodeData,
};

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

export const DATA_NODE_TYPES: NodeType[] = ["price", "volume", "rsi", "constant"];
export const LOGIC_NODE_TYPES: NodeType[] = ["compare", "cross", "and", "or", "not"];
export const ACTION_NODE_TYPES: NodeType[] = ["open_position", "close_position", "set_risk"];

// ---------------------------------------------------------------------------
// React Flow node / edge schemas
// ---------------------------------------------------------------------------

export const StrategyNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
});

export const StrategyEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
});

export const StrategyGraphSchema = z.object({
  nodes: z.array(StrategyNodeSchema).min(1),
  edges: z.array(StrategyEdgeSchema),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type StrategyNode = z.infer<typeof StrategyNodeSchema>;
export type StrategyEdge = z.infer<typeof StrategyEdgeSchema>;
export type StrategyGraph = z.infer<typeof StrategyGraphSchema>;
