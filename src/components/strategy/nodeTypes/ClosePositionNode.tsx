"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function ClosePositionNode(props: NodeProps) {
  return (
    <BaseNode
      {...props}
      title="Close Position"
      inputHandles={[{ id: "trigger" }]}
      outputHandle={false}
    >
      <span className="node-label">close all</span>
    </BaseNode>
  );
}
