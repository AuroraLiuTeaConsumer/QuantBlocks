"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function ConstantNode(props: NodeProps) {
  const { id, data } = props;
  const value = typeof data?.value === "number" ? data.value : 0;
  const { setNodes } = useReactFlow();

  const setValue = (v: number) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, value: v } } : n))
    );
  };

  return (
    <BaseNode {...props} title="Constant" outputHandle>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="nodrag w-20 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-sm text-gray-200"
        />
      </div>
    </BaseNode>
  );
}
