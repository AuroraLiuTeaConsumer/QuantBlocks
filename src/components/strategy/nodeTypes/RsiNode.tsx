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
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, period: value } } : n
      )
    );
  };

  return (
    <BaseNode {...props} title="RSI" outputHandle>
      <div className="flex items-center gap-1.5">
        <label className="node-label">period</label>
        <input
          type="number"
          min={1}
          max={100}
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value) || 14)}
          className="node-input w-14"
        />
      </div>
    </BaseNode>
  );
}
