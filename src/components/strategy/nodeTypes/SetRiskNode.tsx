"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function SetRiskNode(props: NodeProps) {
  const { id, data } = props;
  const slPct = typeof data?.slPct === "number" ? data.slPct : undefined;
  const tpPct = typeof data?.tpPct === "number" ? data.tpPct : undefined;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...updates } } : n))
    );
  };

  return (
    <BaseNode {...props} title="Set risk" inputHandles={[{ id: "trigger" }]} outputHandle={false}>
      <div className="mt-1 space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <label className="w-8 text-xs text-gray-500">SL%</label>
          <input
            type="number"
            step="0.1"
            min={0}
            placeholder="—"
            value={slPct ?? ""}
            onChange={(e) => update({ slPct: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="nodrag w-16 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-8 text-xs text-gray-500">TP%</label>
          <input
            type="number"
            step="0.1"
            min={0}
            placeholder="—"
            value={tpPct ?? ""}
            onChange={(e) => update({ tpPct: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="nodrag w-16 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
          />
        </div>
      </div>
    </BaseNode>
  );
}
