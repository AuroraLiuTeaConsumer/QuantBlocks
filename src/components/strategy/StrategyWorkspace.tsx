"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { StrategyCanvas } from "./StrategyCanvas";
import { AiPromptPanel } from "./AiPromptPanel";
import { BacktestPanel } from "./BacktestPanel";
import { StrategyGraphSchema } from "@/lib/strategy/graphTypes";
import type { StrategyGraph, StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";
import { useRef } from "react";

export type StrategyWorkspaceStrategy = {
  id: string;
  name: string;
  description: string | null;
  instrument: string;
  timeframe: string;
  nodes: unknown;
  edges: unknown;
};

const emptyGraph: StrategyGraph = { nodes: [], edges: [] };

function parseStrategyGraph(strategy: StrategyWorkspaceStrategy): StrategyGraph {
  const parsed = StrategyGraphSchema.safeParse({
    nodes: strategy.nodes,
    edges: strategy.edges,
  });
  return parsed.success ? parsed.data : emptyGraph;
}

export function StrategyWorkspace({ strategy }: { strategy: StrategyWorkspaceStrategy }) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<StrategyGraph | null>(null);
  const [appliedGraph, setAppliedGraph] = useState<StrategyGraph | null>(null);
  const [saveRequestKey, setSaveRequestKey] = useState<number | undefined>(undefined);
  const [isCanvasSaving, setIsCanvasSaving] = useState(false);

  const parsedFromServer = useMemo(
    () => parseStrategyGraph(strategy),
    [strategy.nodes, strategy.edges]
  );

  const displayGraph = appliedGraph ?? parsedFromServer;
  const initialNodes: StrategyNode[] = displayGraph.nodes;
  const initialEdges: StrategyEdge[] = displayGraph.edges;

  useEffect(() => {
    setAppliedGraph(null);
  }, [strategy.id]);

  const prevGraphRef = useRef<StrategyGraph | null>(null);
  
  const handleApplyDraft = () => {
    if (!draftGraph) return;
    setSaveError(null);
    prevGraphRef.current = displayGraph; 
    setAppliedGraph(draftGraph);
    setDraftGraph(null);
    setSaveRequestKey((k) => (k ?? 0) + 1);
  };

  const handleCancelDraft = () => {
    setDraftGraph(null);
  };
  

  return (
    <main className="flex h-screen max-w-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/strategies"
            className="text-sm text-gray-400 transition-colors hover:text-gray-200"
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
        <div className="border-b border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {saveError}
        </div>
      )}
      {draftGraph != null && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-900/50 bg-amber-900/20 px-4 py-2 text-sm">
          <span className="text-amber-200">
            Draft ready — apply to replace the canvas and save.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancelDraft}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyDraft}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Apply Strategy
            </button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-row">
        <AiPromptPanel
          onDraft={setDraftGraph}
          onError={setSaveError}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <StrategyCanvas
            strategyId={strategy.id}
            initialNodes={initialNodes}
            initialEdges={initialEdges}
            onSaveSuccess={() => {
              setSaveError(null);
              prevGraphRef.current = null;
              setAppliedGraph(null);
            }}
            onSaveError={(msg) => {
              setSaveError(msg);
              if (prevGraphRef.current) {
                setAppliedGraph(prevGraphRef.current);
                prevGraphRef.current = null;
              }
            }}
            onSavingChange={setIsCanvasSaving}
            saveRequestKey={saveRequestKey}
            />
          </div>
          <BacktestPanel
            strategyId={strategy.id}
            disableRun={isCanvasSaving}
          />
        </div>
      </div>
    </main>
  );
}
