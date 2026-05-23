"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

const DIRECTIONS = ["crossUp", "crossDown"] as const;

export function CrossNode(props: NodeProps) {
  const { id, data } = props;
  const direction = (DIRECTIONS as readonly string[]).includes(
    data?.direction as string
  )
    ? (data.direction as string)
    : "crossUp";
  const { setNodes } = useReactFlow();

  const setDirection = (d: string) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, direction: d } } : n
      )
    );
  };

  return (
    <BaseNode
      {...props}
      title="Cross"
      inputHandles={[{ id: "a" }, { id: "b" }]}
      outputHandle
    >
      <div className="flex gap-1">
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={direction === d ? "node-chip-active" : "node-chip"}
          >
            {d === "crossUp" ? "↗ up" : "↘ down"}
          </button>
        ))}
      </div>
    </BaseNode>
  );
}
