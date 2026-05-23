"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const OPS = [">", "<", ">=", "<=", "=="] as const;
const RIGHT_TYPES = ["number", "series"] as const;

export function CompareNode(props: NodeProps) {
  const { id, data } = props;
  const op = (OPS as readonly string[]).includes(data?.op as string)
    ? (data.op as string)
    : ">";
  const rightType = (RIGHT_TYPES as readonly string[]).includes(
    data?.rightType as string
  )
    ? (data.rightType as string)
    : "number";
  const rightValue = typeof data?.rightValue === "number" ? data.rightValue : 0;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...updates } } : n
      )
    );
  };

  return (
    <BaseNode
      {...props}
      title="Compare"
      inputHandles={[{ id: "left" }, { id: "right" }]}
      outputHandle
    >
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1">
          {OPS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => update({ op: o })}
              className={op === o ? "node-chip-active" : "node-chip"}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={rightType}
            onChange={(e) => update({ rightType: e.target.value })}
            className="node-select"
          >
            <option value="number">number</option>
            <option value="series">series</option>
          </select>
          {rightType === "number" && (
            <input
              type="number"
              step="any"
              value={rightValue}
              onChange={(e) => update({ rightValue: Number(e.target.value) })}
              className="node-input w-14"
            />
          )}
        </div>
      </div>
    </BaseNode>
  );
}
