"use client";

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

const baseClass =
  "rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 min-w-[120px] text-left shadow";

type BaseNodeProps = NodeProps & {
  title: string;
  inputHandles?: { id: string }[];
  outputHandle?: boolean;
  children?: React.ReactNode;
};

export function BaseNode({
  id,
  data,
  title,
  inputHandles = [],
  outputHandle = true,
  children,
}: BaseNodeProps) {
  return (
    <div className={baseClass}>
      {inputHandles.map((h) => (
        <Handle key={h.id} type="target" position={Position.Left} id={h.id} className="!w-2 !h-2 !-left-1 !border-gray-500 !bg-gray-700" />
      ))}
      {outputHandle && (
        <Handle type="source" position={Position.Right} id="out" className="!w-2 !h-2 !-right-1 !border-gray-500 !bg-gray-700" />
      )}
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}
