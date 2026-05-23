"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const FIELDS = ["close", "open", "high", "low"] as const;

export function PriceNode(props: NodeProps) {
  const { id, data } = props;
  const field = (FIELDS as readonly string[]).includes(data?.field as string)
    ? (data.field as string)
    : "close";
  const { setNodes } = useReactFlow();

  const setField = (f: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, field: f } } : n))
    );
  };

  return (
    <BaseNode {...props} title="Price" outputHandle>
      <select
        value={field}
        onChange={(e) => setField(e.target.value)}
        className="node-select w-full"
      >
        {FIELDS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </BaseNode>
  );
}
