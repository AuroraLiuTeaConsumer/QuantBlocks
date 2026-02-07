"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function NotNode(props: NodeProps) {
  return (
    <BaseNode {...props} title="NOT" inputHandles={[{ id: "in" }]} outputHandle>
      <div className="mt-1 text-xs text-gray-500">¬ boolean</div>
    </BaseNode>
  );
}
