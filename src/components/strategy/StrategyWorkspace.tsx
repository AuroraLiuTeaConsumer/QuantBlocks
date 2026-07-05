"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { StrategyCanvas } from "./StrategyCanvas";
import { NodePalette } from "./NodePalette";
import { AiBuilderPanel } from "./AiBuilderPanel";
import { BacktestPanel } from "./BacktestPanel";
import { PaperTradingPanel } from "./PaperTradingPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StrategyGraphSchema } from "@/lib/strategy/graphTypes";
import type { StrategyGraph, StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";
import { TIMEFRAMES } from "@/lib/market-data/types";

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

function TimeframeStrip({
  value,
  disabled,
  paperSessionBusy,
  onChange,
}: {
  value: string;
  disabled: boolean;
  paperSessionBusy: boolean;
  onChange: (timeframe: string) => void;
}) {
  const disabledReason = paperSessionBusy
    ? "Stop the paper session to change timeframe."
    : "Saving timeframe…";

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      title={disabled ? disabledReason : "Chart timeframe"}
    >
      <span className="hidden shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3 lg:flex">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="4.5" />
          <path d="M6 3.5V6l1.75 1" />
        </svg>
        Interval
      </span>
      <div className="min-w-0 overflow-x-auto">
        <div
          role="group"
          aria-label="Chart timeframe"
          aria-busy={disabled && !paperSessionBusy}
          className="flex w-max items-center gap-0.5 rounded-md border border-line bg-surface-alt p-0.5"
        >
          {TIMEFRAMES.map((timeframe) => {
            const active = timeframe === value;
            return (
              <button
                key={timeframe}
                type="button"
                aria-label={`Use ${timeframe} timeframe`}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onChange(timeframe)}
                className={`min-w-8 shrink-0 rounded px-1.5 py-1 font-mono text-[11px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  active
                    ? "bg-accent text-white shadow-[0_1px_3px_rgba(41,98,255,0.3)]"
                    : "text-ink-2 hover:bg-surface hover:text-ink-1"
                } disabled:cursor-not-allowed ${active ? "" : "disabled:opacity-45"}`}
              >
                {timeframe}
              </button>
            );
          })}
        </div>
      </div>
    </div>
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

  // Editable timeframe — synced from strategy prop on mount/strategy change
  const [currentTimeframe, setCurrentTimeframe] = useState(strategy.timeframe);
  const [isTimeframeSaving, setIsTimeframeSaving] = useState(false);
  const [paperSessionBusy, setPaperSessionBusy] = useState(false);
  const timeframeRequestRef = useRef(0);
  const timeframeSavingRef = useRef(false);

  // Sync currentTimeframe if the server prop changes (e.g. full-page re-render)
  useEffect(() => {
    setCurrentTimeframe(strategy.timeframe);
  }, [strategy.timeframe]);

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

  const handleTimeframeChange = async (newTf: string) => {
    if (timeframeSavingRef.current || newTf === currentTimeframe) return;

    const prevTf = currentTimeframe;
    const requestId = ++timeframeRequestRef.current;
    timeframeSavingRef.current = true;
    setCurrentTimeframe(newTf);
    setIsTimeframeSaving(true);
    setSaveError(null);
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/strategies/${strategy.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeframe: newTf }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (requestId !== timeframeRequestRef.current) return;
        setCurrentTimeframe(prevTf);
        setSaveError(data.error ?? "Failed to update timeframe");
        setSaveStatus("error");
      } else {
        const data = await res.json() as { timeframe?: string };
        if (requestId !== timeframeRequestRef.current) return;
        if (data.timeframe) setCurrentTimeframe(data.timeframe);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
    } catch {
      if (requestId !== timeframeRequestRef.current) return;
      setCurrentTimeframe(prevTf);
      setSaveError("Network error updating timeframe");
      setSaveStatus("error");
    } finally {
      if (requestId === timeframeRequestRef.current) {
        timeframeSavingRef.current = false;
        setIsTimeframeSaving(false);
      }
    }
  };

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
          className="flex shrink-0 items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink-1"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2.5 4.5 7 9 11.5" />
          </svg>
          Strategies
        </Link>
        <div className="h-[18px] w-px bg-line" />
        <span className="max-w-48 truncate text-sm font-bold text-ink-1">{strategy.name}</span>
        <div className="flex shrink-0 items-center rounded-md border border-line bg-surface-alt px-2 py-1">
          <span className="font-mono text-[11px] font-semibold text-ink-1">{strategy.instrument}</span>
        </div>
        <div className="min-w-0 flex-1">
          <TimeframeStrip
            value={currentTimeframe}
            disabled={paperSessionBusy || isTimeframeSaving}
            paperSessionBusy={paperSessionBusy}
            onChange={handleTimeframeChange}
          />
        </div>
        <div className="shrink-0">
          <SaveStatus status={saveStatus} />
        </div>
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

          {/* Canvas + side AI Builder panel */}
          <div className="flex min-h-0 flex-1">
            <div className="relative min-h-0 flex-1">
              <ErrorBoundary label="Canvas">
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
              </ErrorBoundary>
            </div>
            <ErrorBoundary label="AI Builder">
              <AiBuilderPanel
                open={aiOpen}
                onClose={() => setAiOpen(false)}
                onDraft={(g) => {
                  setDraftGraph(g);
                  setAiOpen(false);
                }}
                onError={setSaveError}
                canvasGraph={displayGraph}
              />
            </ErrorBoundary>
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
                <ErrorBoundary label="Backtest">
                  <BacktestPanel
                    strategyId={strategy.id}
                    strategyTimeframe={currentTimeframe}
                    disableRun={isCanvasSaving || hasPendingApply}
                  />
                </ErrorBoundary>
              </div>
              <div className="h-full" style={bottomTab !== "paper" ? { display: "none" } : undefined}>
                <ErrorBoundary label="Paper Trading">
                  <PaperTradingPanel
                    strategyId={strategy.id}
                    disableRun={isCanvasSaving || hasPendingApply}
                    onSessionBusyChange={setPaperSessionBusy}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
