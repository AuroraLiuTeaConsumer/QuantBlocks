"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const SIDES = ["long", "short"] as const;

export function OpenPositionNode(props: NodeProps) {
  const { id, data } = props;
  const side = (SIDES as readonly string[]).includes(data?.side as string)
    ? (data.side as string)
    : "long";
  const qty = typeof data?.qty === "number" ? data.qty : 0.01;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, qtyType: "fixed", ...updates } }
          : n
      )
    );
  };

  return (
    <BaseNode
      {...props}
      title="Open Position"
      inputHandles={[{ id: "trigger" }]}
      outputHandle={false}
    >
      <div className="space-y-1">
        <div className="flex gap-1">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update({ side: s })}
              className={side === s ? "node-chip-active" : "node-chip"}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <label className="node-label">qty</label>
          <input
            type="number"
            step="0.001"
            min={0}
            value={qty}
            onChange={(e) => update({ qty: Number(e.target.value) || 0 })}
            className="node-input w-14"
          />
        </div>
      </div>
    </BaseNode>
  );
}
