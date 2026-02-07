"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function ClosePositionNode(props: NodeProps) {
  return (
    <BaseNode {...props} title="Close position" inputHandles={[{ id: "trigger" }]} outputHandle={false}>
      <div className="mt-1 text-xs text-gray-500">close all</div>
    </BaseNode>
  );
}
