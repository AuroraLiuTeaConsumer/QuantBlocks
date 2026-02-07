"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function OrNode(props: NodeProps) {
  return (
    <BaseNode {...props} title="OR" inputHandles={[{ id: "a" }, { id: "b" }]} outputHandle>
      <div className="mt-1 text-xs text-gray-500">boolean | boolean</div>
    </BaseNode>
  );
}
