"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function NotNode(props: NodeProps) {
  return (
    <BaseNode
      {...props}
      title="NOT"
      inputHandles={[{ id: "in" }]}
      outputHandle
    >
      <span className="node-label">¬ bool</span>
    </BaseNode>
  );
}
