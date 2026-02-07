"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function RsiNode(props: NodeProps) {
  const { id, data } = props;
  const period = typeof data?.period === "number" ? data.period : 14;
  const { setNodes } = useReactFlow();

  const setPeriod = (value: number) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, period: value } } : n))
    );
  };

  return (
    <BaseNode {...props} title="RSI" outputHandle>
      <div className="mt-1 flex items-center gap-2">
        <label className="text-xs text-gray-500">period</label>
        <input
          type="number"
          min={1}
          max={100}
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value) || 14)}
          className="nodrag w-14 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-sm text-gray-200"
        />
      </div>
    </BaseNode>
  );
}
