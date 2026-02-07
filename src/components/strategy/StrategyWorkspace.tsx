"use client";

import { useState } from "react";
import Link from "next/link";
import { StrategyCanvas } from "./StrategyCanvas";
import type { StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";

export type StrategyWorkspaceStrategy = {
  id: string;
  name: string;
  description: string | null;
  instrument: string;
  timeframe: string;
  nodes: unknown;
  edges: unknown;
};

export function StrategyWorkspace({ strategy }: { strategy: StrategyWorkspaceStrategy }) {
  const [saveError, setSaveError] = useState<string | null>(null);

  const nodes = Array.isArray(strategy.nodes) ? (strategy.nodes as StrategyNode[]) : [];
  const edges = Array.isArray(strategy.edges) ? (strategy.edges as StrategyEdge[]) : [];

  return (
    <main className="h-screen flex flex-col max-w-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/strategies"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-xl font-bold text-gray-100">{strategy.name}</h1>
          <span className="text-xs text-gray-500">
            {strategy.instrument} · {strategy.timeframe}
          </span>
        </div>
      </header>
      {saveError && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-sm text-red-300">
          {saveError}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        <StrategyCanvas
          strategyId={strategy.id}
          initialNodes={nodes}
          initialEdges={edges}
          onSaveSuccess={() => setSaveError(null)}
          onSaveError={setSaveError}
        />
      </div>
    </main>
  );
}
