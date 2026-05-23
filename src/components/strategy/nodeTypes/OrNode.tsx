"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function OrNode(props: NodeProps) {
  return (
    <BaseNode
      {...props}
      title="OR"
      inputHandles={[{ id: "a" }, { id: "b" }]}
      outputHandle
    >
      <span className="node-label">bool | bool</span>
    </BaseNode>
  );
}
