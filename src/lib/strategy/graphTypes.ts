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

export const CompareNodeData = z
  .object({
    op: z.enum([">", "<", ">=", "<=", "=="]),
    rightType: z.enum(["number", "series"]).default("number"),
    rightValue: z.number().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.rightType === "number" && typeof val.rightValue !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "compare.rightValue is required when rightType is 'number'",
        path: ["rightValue"],
      });
    }
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

export const IndicatorNodeData = z.object({
  indicatorId: z.string(),
  params: z.record(z.union([z.number(), z.string()])).default({}),
  indicatorName: z.string().optional(),
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
  "indicator",
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
  indicator: IndicatorNodeData,
};

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

export const DATA_NODE_TYPES: NodeType[] = ["price", "volume", "rsi", "constant", "indicator"];
export const LOGIC_NODE_TYPES: NodeType[] = ["compare", "cross", "and", "or", "not"];
export const ACTION_NODE_TYPES: NodeType[] = ["open_position", "close_position", "set_risk"];

// ---------------------------------------------------------------------------
// React Flow node / edge schemas
// ---------------------------------------------------------------------------

const BaseNode = z.object({
  id: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
});

export const StrategyNodeSchema = z.discriminatedUnion("type", [
  BaseNode.extend({ type: z.literal("price"), data: PriceNodeData }),
  BaseNode.extend({ type: z.literal("volume"), data: VolumeNodeData }),
  BaseNode.extend({ type: z.literal("rsi"), data: RsiNodeData }),
  BaseNode.extend({ type: z.literal("compare"), data: CompareNodeData }),
  BaseNode.extend({ type: z.literal("cross"), data: CrossNodeData }),
  BaseNode.extend({ type: z.literal("and"), data: AndNodeData }),
  BaseNode.extend({ type: z.literal("or"), data: OrNodeData }),
  BaseNode.extend({ type: z.literal("not"), data: NotNodeData }),
  BaseNode.extend({ type: z.literal("constant"), data: ConstantNodeData }),
  BaseNode.extend({ type: z.literal("open_position"), data: OpenPositionNodeData }),
  BaseNode.extend({ type: z.literal("close_position"), data: ClosePositionNodeData }),
  BaseNode.extend({ type: z.literal("set_risk"), data: SetRiskNodeData }),
  BaseNode.extend({ type: z.literal("indicator"), data: IndicatorNodeData }),
]);


export const StrategyEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
});

export const StrategyGraphSchema = z.object({
  nodes: z.array(StrategyNodeSchema),
  edges: z.array(StrategyEdgeSchema),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type StrategyNode = z.infer<typeof StrategyNodeSchema>;
export type StrategyEdge = z.infer<typeof StrategyEdgeSchema>;
export type StrategyGraph = z.infer<typeof StrategyGraphSchema>;
