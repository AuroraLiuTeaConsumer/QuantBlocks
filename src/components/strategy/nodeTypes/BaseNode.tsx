"use client";

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";

type CategoryKey = "data" | "indicator" | "logic" | "action-open" | "action-close";

const CATEGORY_BY_TYPE: Record<string, CategoryKey> = {
  price: "data",
  volume: "data",
  rsi: "indicator",
  constant: "indicator",
  compare: "logic",
  cross: "logic",
  and: "logic",
  or: "logic",
  not: "logic",
  open_position: "action-open",
  set_risk: "action-open",
  close_position: "action-close",
};

const COLOR: Record<
  CategoryKey,
  { bg: string; border: string; text: string; dot: string }
> = {
  data: {
    bg: "var(--accent-bg)",
    border: "var(--accent)",
    text: "var(--accent)",
    dot: "var(--accent)",
  },
  indicator: {
    bg: "var(--purple-bg)",
    border: "var(--purple)",
    text: "var(--purple)",
    dot: "var(--purple)",
  },
  logic: {
    bg: "var(--surface-2)",
    border: "var(--border-2)",
    text: "var(--text-2)",
    dot: "var(--text-3)",
  },
  "action-open": {
    bg: "var(--green-bg)",
    border: "var(--green)",
    text: "var(--green)",
    dot: "var(--green)",
  },
  "action-close": {
    bg: "var(--red-bg)",
    border: "var(--red)",
    text: "var(--red)",
    dot: "var(--red)",
  },
};

type BaseNodeProps = NodeProps & {
  title: string;
  inputHandles?: { id: string }[];
  outputHandle?: boolean;
  children?: React.ReactNode;
};

export function BaseNode({
  type,
  selected,
  title,
  inputHandles = [],
  outputHandle = true,
  children,
}: BaseNodeProps) {
  const cat = CATEGORY_BY_TYPE[type ?? ""] ?? "logic";
  const c = COLOR[cat];

  return (
    <div
      className="overflow-hidden rounded-[9px] border bg-surface transition-shadow"
      style={{
        width: 152,
        borderColor: selected ? c.border : "var(--border)",
        borderWidth: 1.5,
        boxShadow: selected
          ? `0 0 0 3px ${c.bg}, 0 2px 8px rgba(0,0,0,0.1)`
          : "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{
          background: c.bg,
          borderBottom: `1px solid ${c.border}30`,
        }}
      >
        <span
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: c.dot }}
        />
        <span
          className="text-[11px] font-semibold leading-none"
          style={{ color: c.text }}
        >
          {title}
        </span>
      </div>

      {/* Body */}
      {children != null && (
        <div className="nodrag px-2.5 py-1.5 text-xs text-ink-2">{children}</div>
      )}

      {/* Handles */}
      {inputHandles.map((h) => (
        <Handle key={h.id} type="target" position={Position.Left} id={h.id} />
      ))}
      {outputHandle && (
        <Handle type="source" position={Position.Right} id="out" />
      )}
    </div>
  );
}
