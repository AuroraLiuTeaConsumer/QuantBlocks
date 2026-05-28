"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { strategyNodeTypes } from "./nodeTypes";
import type { StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";
import { PALETTE_DND_TYPE } from "./NodePalette";

const DEBOUNCE_MS = 1500;

function persistGraph(
  strategyId: string,
  nodes: Node[],
  edges: Edge[]
): Promise<Response> {
  const payload = {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: e.type,
    })),
  };
  return fetch(`/api/strategies/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function nextNodeId(existing: Node[]): string {
  let i = 1;
  const taken = new Set(existing.map((n) => n.id));
  while (taken.has(`n${i}`)) i++;
  return `n${i}`;
}

function FlowCanvas({
  strategyId,
  initialNodes,
  initialEdges,
  onSaveSuccess,
  onSaveError,
  onSavingChange,
  saveRequestKey,
}: {
  strategyId: string;
  initialNodes: StrategyNode[];
  initialEdges: StrategyEdge[];
  onSaveSuccess?: () => void;
  onSaveError?: (message: string) => void;
  onSavingChange?: (saving: boolean) => void;
  saveRequestKey?: number;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as Edge[]);
  const [saving, setSaving] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserChangedRef = useRef(false);
  const lastSaveRequestKeyRef = useRef(saveRequestKey ?? -1);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await persistGraph(strategyId, nodes, edges);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.details?.length
          ? body.details.map((e: { message?: string }) => e.message).join("; ")
          : body.error ?? "Save failed";
        onSaveError?.(message);
        return;
      }
      onSaveSuccess?.();
    } catch (err) {
      onSaveError?.(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [strategyId, nodes, edges, onSaveSuccess, onSaveError]);

  useEffect(() => {
    if (!hasUserChangedRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      save();
    }, DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, edges, save]);

  useEffect(() => {
    setNodes(initialNodes as Node[]);
    setEdges(initialEdges as Edge[]);
    hasUserChangedRef.current = false;
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // One-time save when parent requests it (e.g. after Apply draft)
  useEffect(() => {
    const key = saveRequestKey ?? -1;
    if (key !== lastSaveRequestKeyRef.current && key >= 0) {
      lastSaveRequestKeyRef.current = key;
      (async () => {
        setSaving(true);
        try {
          const res = await persistGraph(
            strategyId,
            initialNodes as Node[],
            initialEdges as Edge[]
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.details?.length
              ? body.details.map((e: { message?: string }) => e.message).join("; ")
              : body.error ?? "Save failed";
            onSaveError?.(message);
            return;
          }
          onSaveSuccess?.();
        } catch (err) {
          onSaveError?.(err instanceof Error ? err.message : "Save failed");
        } finally {
          setSaving(false);
        }
      })();
    }
  }, [saveRequestKey, strategyId, initialNodes, initialEdges, onSaveSuccess, onSaveError]);

  const onNodesChangeWithDirty = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) {
        hasUserChangedRef.current = true;
      }
      onNodesChange(changes);
    },
    [onNodesChange]
  );
  const onEdgesChangeWithDirty = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      hasUserChangedRef.current = true;
      onEdgesChange(changes);
    },
    [onEdgesChange]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      hasUserChangedRef.current = true;
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges]
  );

  // ── Drop support for NodePalette drags ─────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(PALETTE_DND_TYPE);
      if (!raw) return;
      let payload: { type: string; label?: string; data?: Record<string, unknown> };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newNode: Node = {
        id: nextNodeId(nodes),
        type: payload.type,
        position,
        data: payload.data ?? {},
      };
      hasUserChangedRef.current = true;
      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, nodes, setNodes]
  );

  return (
    <div ref={wrapperRef} className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeWithDirty}
        onEdgesChange={onEdgesChangeWithDirty}
        onConnect={onConnect}
        nodeTypes={strategyNodeTypes}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        className="bg-[#f8f9fd]"
      >
        <Controls />
        <MiniMap
          maskColor="rgba(241, 245, 250, 0.6)"
          nodeColor={() => "var(--accent-bg)"}
          nodeStrokeColor={() => "var(--accent)"}
          nodeStrokeWidth={2}
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="rgba(0,0,0,0.09)" />
      </ReactFlow>
    </div>
  );
}

export function StrategyCanvas(props: {
  strategyId: string;
  initialNodes: StrategyNode[];
  initialEdges: StrategyEdge[];
  onSaveSuccess?: () => void;
  onSaveError?: (message: string) => void;
  onSavingChange?: (saving: boolean) => void;
  saveRequestKey?: number;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
}
