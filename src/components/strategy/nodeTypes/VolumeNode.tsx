"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function VolumeNode(props: NodeProps) {
  return (
    <BaseNode {...props} title="Volume" outputHandle>
      <span className="node-label">series</span>
    </BaseNode>
  );
}
