"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { StrategyCanvas } from "./StrategyCanvas";
import { NodePalette } from "./NodePalette";
import { AiPromptPanel } from "./AiPromptPanel";
import { BacktestPanel } from "./BacktestPanel";
import { PaperTradingPanel } from "./PaperTradingPanel";
import { StrategyGraphSchema } from "@/lib/strategy/graphTypes";
import type { StrategyGraph, StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";

type BottomTab = "backtest" | "paper";

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
const MIN_DRAWER = 40;
const MAX_DRAWER = 600;
const DEFAULT_DRAWER = 280;

function parseStrategyGraph(strategy: StrategyWorkspaceStrategy): StrategyGraph {
  const parsed = StrategyGraphSchema.safeParse({
    nodes: strategy.nodes,
    edges: strategy.edges,
  });
  return parsed.success ? parsed.data : emptyGraph;
}

function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;
  const map = {
    saving: { color: "var(--amber)", label: "Saving…" },
    saved: { color: "var(--green)", label: "Saved" },
    error: { color: "var(--red)", label: "Save failed" },
  };
  const s = map[status];
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-medium"
      style={{ color: s.color }}
    >
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  );
}

export function StrategyWorkspace({ strategy }: { strategy: StrategyWorkspaceStrategy }) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<StrategyGraph | null>(null);
  const [appliedGraph, setAppliedGraph] = useState<StrategyGraph | null>(null);
  const [saveRequestKey, setSaveRequestKey] = useState<number | undefined>(undefined);
  const [isCanvasSaving, setIsCanvasSaving] = useState(false);
  const [hasPendingApply, setHasPendingApply] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>("backtest");
  const [aiOpen, setAiOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);

  const parsedFromServer = useMemo(
    () => parseStrategyGraph(strategy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strategy.nodes, strategy.edges]
  );

  const displayGraph = appliedGraph ?? parsedFromServer;
  const initialNodes: StrategyNode[] = displayGraph.nodes;
  const initialEdges: StrategyEdge[] = displayGraph.edges;

  useEffect(() => {
    setAppliedGraph(null);
  }, [strategy.id]);

  // Track save status timeline
  useEffect(() => {
    if (isCanvasSaving) setSaveStatus("saving");
  }, [isCanvasSaving]);

  const prevGraphRef = useRef<StrategyGraph | null>(null);

  const handleApplyDraft = () => {
    if (!draftGraph) return;
    setSaveError(null);
    prevGraphRef.current = displayGraph;
    setAppliedGraph(draftGraph);
    setDraftGraph(null);
    setHasPendingApply(true);
    setSaveRequestKey((k) => (k ?? 0) + 1);
  };

  const handleCancelDraft = () => setDraftGraph(null);

  // Drawer resize
  const dragRef = useRef({ active: false, startY: 0, startH: DEFAULT_DRAWER });
  const onResizeStart = (e: React.MouseEvent) => {
    dragRef.current = { active: true, startY: e.clientY, startH: drawerHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };
  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.startY - e.clientY;
      const next = Math.max(MIN_DRAWER, Math.min(MAX_DRAWER, dragRef.current.startH + delta));
      setDrawerHeight(next);
      if (next > 55) setDrawerCollapsed(false);
    };
    const up = () => {
      dragRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const displayDrawerH = drawerCollapsed ? 40 : drawerHeight;

  return (
    <main className="flex h-screen max-w-full flex-col bg-[var(--bg)]">
      {/* Header */}
      <header className="flex h-[44px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-3.5">
        <Link
          href="/strategies"
          className="flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink-1"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2.5 4.5 7 9 11.5" />
          </svg>
          Strategies
        </Link>
        <div className="h-[18px] w-px bg-line" />
        <span className="text-sm font-bold text-ink-1">{strategy.name}</span>
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface-alt px-2 py-0.5">
          <span className="font-mono text-[11px] font-semibold text-ink-1">{strategy.instrument}</span>
          <span className="text-[11px] text-ink-3">·</span>
          <span className="font-mono text-[11px] text-ink-2">{strategy.timeframe}</span>
        </div>
        <div className="flex-1" />
        <SaveStatus status={saveStatus} />
      </header>

      {/* Apply-draft banner */}
      {draftGraph != null && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-warn/30 bg-warn-bg px-4 py-2 text-xs">
          <span className="font-medium text-warn">
            Draft ready — apply to replace the canvas and save.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancelDraft}
              className="rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyDraft}
              className="rounded-md bg-warn px-3 py-1 text-xs font-semibold text-white shadow-[0_1px_4px_rgba(217,119,6,0.3)] hover:brightness-95"
            >
              Apply Strategy
            </button>
          </div>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="border-b border-loss/30 bg-loss-bg px-4 py-2 text-xs text-loss">
          {saveError}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-row">
        <NodePalette />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Canvas toolbar */}
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2.5">
            <div className="flex-1" />
            <div className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => setAiOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 rounded-md border-[1.5px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                aiOpen
                  ? "border-accent bg-accent text-white"
                  : "border-accent-border bg-accent-bg text-accent hover:brightness-95"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
                <path d="M19.5 14l.75 2.25L22.5 17l-2.25.75L19.5 20l-.75-2.25L16.5 17l2.25-.75L19.5 14z" />
              </svg>
              AI Builder
            </button>
          </div>

          {/* Canvas + floating AI panel */}
          <div className="relative min-h-0 flex-1">
            <StrategyCanvas
              strategyId={strategy.id}
              initialNodes={initialNodes}
              initialEdges={initialEdges}
              onSaveSuccess={() => {
                setSaveError(null);
                prevGraphRef.current = null;
                setHasPendingApply(false);
                setSaveStatus("saved");
                setTimeout(() => setSaveStatus("idle"), 2500);
              }}
              onSaveError={(msg) => {
                setSaveError(msg);
                if (prevGraphRef.current) {
                  setAppliedGraph(prevGraphRef.current);
                  prevGraphRef.current = null;
                }
                setHasPendingApply(false);
                setSaveStatus("error");
              }}
              onSavingChange={setIsCanvasSaving}
              saveRequestKey={saveRequestKey}
            />
            <AiPromptPanel
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              onDraft={(g) => {
                setDraftGraph(g);
                setAiOpen(false);
              }}
              onError={setSaveError}
            />
          </div>

          {/* Bottom drawer */}
          <div
            className="flex shrink-0 flex-col border-t border-line bg-surface"
            style={{
              height: displayDrawerH,
              transition: drawerCollapsed ? "height 0.15s ease" : undefined,
            }}
          >
            {/* Resize handle */}
            <div
              onMouseDown={onResizeStart}
              className="flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center"
            >
              <div className="h-[3px] w-9 rounded-sm bg-line-strong" />
            </div>

            {/* Tab bar */}
            <div
              className={`flex h-[34px] shrink-0 items-center gap-0.5 px-3 ${
                drawerCollapsed ? "" : "border-b border-line"
              }`}
            >
              {(["backtest", "paper"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setBottomTab(t);
                    setDrawerCollapsed(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs"
                  style={{
                    color: bottomTab === t ? "var(--text-1)" : "var(--text-2)",
                    fontWeight: bottomTab === t ? 600 : 400,
                    borderBottom:
                      bottomTab === t
                        ? `2px solid ${t === "backtest" ? "var(--green)" : "var(--accent)"}`
                        : "2px solid transparent",
                    marginBottom: -1,
                  }}
                >
                  {t === "backtest" ? "Backtest" : "Paper Trading"}
                </button>
              ))}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setDrawerCollapsed((c) => !c)}
                className="ml-1.5 flex p-1 text-ink-3 transition-transform hover:text-ink-2"
                style={{
                  transform: drawerCollapsed ? "rotate(180deg)" : "none",
                }}
                aria-label="Toggle drawer"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4l3.5 3.5L9 4" />
                </svg>
              </button>
            </div>

            {/* Tab content — kept mounted to preserve session state across collapse/tab switch */}
            <div
              className="min-h-0 flex-1 overflow-auto"
              style={{ display: drawerCollapsed ? "none" : undefined }}
            >
              <div className="h-full" style={bottomTab !== "backtest" ? { display: "none" } : undefined}>
                <BacktestPanel
                  strategyId={strategy.id}
                  strategyTimeframe={strategy.timeframe}
                  disableRun={isCanvasSaving || hasPendingApply}
                />
              </div>
              <div className="h-full" style={bottomTab !== "paper" ? { display: "none" } : undefined}>
                <PaperTradingPanel
                  strategyId={strategy.id}
                  disableRun={isCanvasSaving || hasPendingApply}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
