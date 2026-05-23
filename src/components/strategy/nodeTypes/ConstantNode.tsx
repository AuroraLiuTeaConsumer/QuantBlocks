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
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="node-input w-full"
      />
    </BaseNode>
  );
}
