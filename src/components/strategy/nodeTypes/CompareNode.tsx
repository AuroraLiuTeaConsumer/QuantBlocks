"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const OPS = [">", "<", ">=", "<=", "=="] as const;
const RIGHT_TYPES = ["number", "series"] as const;

export function CompareNode(props: NodeProps) {
  const { id, data } = props;
  const op = (OPS as readonly string[]).includes(data?.op as string) ? (data.op as string) : ">";
  const rightType = (RIGHT_TYPES as readonly string[]).includes(data?.rightType as string)
    ? (data.rightType as string)
    : "number";
  const rightValue = typeof data?.rightValue === "number" ? data.rightValue : 0;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n))
    );
  };

  return (
    <BaseNode {...props} title="Compare" inputHandles={[{ id: "left" }, { id: "right" }]} outputHandle>
      <div className="mt-1 space-y-1 text-sm">
        <div className="flex flex-wrap gap-1">
          {OPS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => update({ op: o })}
              className={`nodrag rounded px-1.5 py-0.5 text-xs ${op === o ? "bg-amber-600 text-white" : "bg-gray-700 text-gray-400"}`}
            >
              {o}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rightType}
            onChange={(e) => update({ rightType: e.target.value })}
            className="nodrag rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
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
              className="nodrag w-16 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
            />
          )}
        </div>
      </div>
    </BaseNode>
  );
}
