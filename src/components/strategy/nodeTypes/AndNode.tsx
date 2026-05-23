"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function AndNode(props: NodeProps) {
  return (
    <BaseNode
      {...props}
      title="AND"
      inputHandles={[{ id: "a" }, { id: "b" }]}
      outputHandle
    >
      <span className="node-label">bool & bool</span>
    </BaseNode>
  );
}
