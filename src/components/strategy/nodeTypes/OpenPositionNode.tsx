"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const SIDES = ["long", "short"] as const;

export function OpenPositionNode(props: NodeProps) {
  const { id, data } = props;
  const side = (SIDES as readonly string[]).includes(data?.side as string) ? (data.side as string) : "long";
  const qty = typeof data?.qty === "number" ? data.qty : 0.01;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, qtyType: "fixed", ...updates } } : n))
    );
  };

  return (
    <BaseNode {...props} title="Open position" inputHandles={[{ id: "trigger" }]} outputHandle={false}>
      <div className="mt-1 space-y-1 text-sm">
        <div className="flex gap-1">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ side: s })}
              className={`nodrag rounded px-2 py-0.5 text-xs ${side === s ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">qty</label>
          <input
            type="number"
            step="0.001"
            min={0}
            value={qty}
            onChange={(e) => update({ qty: Number(e.target.value) || 0 })}
            className="nodrag w-16 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
          />
        </div>
      </div>
    </BaseNode>
  );
}
