"use client";

import { useState } from "react";
import type { NodeType } from "@/lib/strategy/graphTypes";

type Category = {
  name: string;
  colorVar: string; // CSS variable for tint
  colorBgVar: string;
  nodes: PaletteNode[];
};

export type PaletteNode = {
  type: NodeType;
  label: string;
  desc: string;
  /** Default data payload when dropping a fresh node onto the canvas */
  defaultData: Record<string, unknown>;
  icon: string;
};

const CATEGORIES: Category[] = [
  {
    name: "Data Sources",
    colorVar: "var(--accent)",
    colorBgVar: "var(--accent-bg)",
    nodes: [
      { type: "price", label: "Price", desc: "OHLCV stream", defaultData: { field: "close" }, icon: "P" },
      { type: "volume", label: "Volume", desc: "Trading volume", defaultData: {}, icon: "V" },
    ],
  },
  {
    name: "Indicators",
    colorVar: "var(--purple)",
    colorBgVar: "var(--purple-bg)",
    nodes: [
      { type: "rsi", label: "RSI", desc: "Relative Strength", defaultData: { period: 14 }, icon: "~" },
      { type: "constant", label: "Constant", desc: "Fixed value", defaultData: { value: 0 }, icon: "#" },
    ],
  },
  {
    name: "Logic",
    colorVar: "var(--text-2)",
    colorBgVar: "var(--surface-2)",
    nodes: [
      { type: "compare", label: "Compare", desc: ">, <, =, ≥, ≤", defaultData: { op: ">", rightType: "number", rightValue: 0 }, icon: "≷" },
      { type: "cross", label: "Crossover", desc: "Detect cross", defaultData: { direction: "crossUp" }, icon: "×" },
      { type: "and", label: "AND", desc: "Both true", defaultData: {}, icon: "∧" },
      { type: "or", label: "OR", desc: "Either true", defaultData: {}, icon: "∨" },
      { type: "not", label: "NOT", desc: "Invert signal", defaultData: {}, icon: "¬" },
    ],
  },
  {
    name: "Actions",
    colorVar: "var(--green)",
    colorBgVar: "var(--green-bg)",
    nodes: [
      { type: "open_position", label: "Open Position", desc: "Enter long/short", defaultData: { side: "long", qtyType: "fixed", qty: 0.01 }, icon: "▶" },
      { type: "close_position", label: "Close Position", desc: "Exit trade", defaultData: {}, icon: "■" },
      { type: "set_risk", label: "Set Risk", desc: "SL / TP %", defaultData: {}, icon: "%" },
    ],
  },
];

/**
 * MIME used to transfer the dragged palette entry to StrategyCanvas.
 * StrategyCanvas listens for this on its drop handler.
 */
export const PALETTE_DND_TYPE = "application/quantblocks-node";

/** Serialize a palette node into a dragstart payload. */
export function serializePaletteNode(node: PaletteNode): string {
  return JSON.stringify({ type: node.type, label: node.label, data: node.defaultData });
}

export function NodePalette() {
  const [open, setOpen] = useState<Record<string, boolean>>({
    "Data Sources": true,
    "Indicators": true,
    "Logic": false,
    "Actions": true,
  });

  return (
    <aside className="flex w-[196px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-2">
          Nodes
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pb-2 pt-1.5">
        {CATEGORIES.map((cat) => {
          const isOpen = open[cat.name];
          return (
            <div key={cat.name}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [cat.name]: !o[cat.name] }))}
                className="flex w-full items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-ink-3 transition-colors hover:text-ink-2"
              >
                <span
                  className="inline-flex transition-transform"
                  style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 2l3.5 3.5L4 9" />
                  </svg>
                </span>
                {cat.name}
              </button>

              {isOpen &&
                cat.nodes.map((node) => (
                  <PaletteEntry
                    key={node.type}
                    node={node}
                    colorVar={cat.colorVar}
                    colorBgVar={cat.colorBgVar}
                  />
                ))}
              <div className="h-1.5" />
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-3 py-2 text-[10px] leading-[1.5] text-ink-3">
        Drag to canvas
      </div>
    </aside>
  );
}

function PaletteEntry({
  node,
  colorVar,
  colorBgVar,
}: {
  node: PaletteNode;
  colorVar: string;
  colorBgVar: string;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DND_TYPE, serializePaletteNode(node));
        // Fallback for browsers that need a generic type set
        e.dataTransfer.setData("text/plain", node.type);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={node.desc}
      className="group mx-2 my-0.5 flex cursor-grab items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 transition-colors hover:bg-[var(--row-bg)] hover:border-[var(--row-border)]"
      style={
        {
          ["--row-bg" as string]: colorBgVar,
          ["--row-border" as string]: colorVar,
        } as React.CSSProperties
      }
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[13px] font-medium"
        style={{
          background: colorBgVar,
          borderColor: colorVar,
          color: colorVar,
        }}
      >
        {node.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-snug text-ink-1">{node.label}</div>
        <div className="text-[10px] leading-tight text-ink-3">{node.desc}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0 text-ink-3 opacity-50 group-hover:opacity-100">
        <circle cx="3.5" cy="3.5" r="1.2" />
        <circle cx="8.5" cy="3.5" r="1.2" />
        <circle cx="3.5" cy="8.5" r="1.2" />
        <circle cx="8.5" cy="8.5" r="1.2" />
      </svg>
    </div>
  );
}
