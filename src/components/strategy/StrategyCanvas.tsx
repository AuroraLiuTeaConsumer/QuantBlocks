"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  Controls,
  MiniMap,
  Background,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { strategyNodeTypes } from "./nodeTypes";
import type { StrategyNode, StrategyEdge } from "@/lib/strategy/graphTypes";

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
  /** When this value changes, one save is triggered (e.g. after Apply draft). */
  saveRequestKey?: number;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges as Edge[]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserChangedRef = useRef(false);
  const lastSaveRequestKeyRef = useRef(saveRequestKey ?? -1);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await persistGraph(strategyId, nodes, edges);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body.details?.length
          ? body.details.map((e: { message?: string }) => e.message).join("; ")
          : body.error ?? "Save failed";
        setSaveStatus("error");
        onSaveError?.(message);
        return;
      }
      setSaveStatus("saved");
      onSaveSuccess?.();
    } catch (err) {
      setSaveStatus("error");
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
    setSaveStatus("idle");
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // One-time save when parent requests it (e.g. after Apply draft). Persist the incoming graph (initialNodes/initialEdges), not current state, so we don't rely on sync effect order.
  useEffect(() => {
    const key = saveRequestKey ?? -1;
    if (key !== lastSaveRequestKeyRef.current && key >= 0) {
      lastSaveRequestKeyRef.current = key;
      (async () => {
        setSaving(true);
        setSaveStatus("idle");
        try {
          const res = await persistGraph(strategyId, initialNodes as Node[], initialEdges as Edge[]);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.details?.length
              ? body.details.map((e: { message?: string }) => e.message).join("; ")
              : body.error ?? "Save failed";
            setSaveStatus("error");
            onSaveError?.(message);
            return;
          }
          setSaveStatus("saved");
          onSaveSuccess?.();
        } catch (err) {
          setSaveStatus("error");
          onSaveError?.(err instanceof Error ? err.message : "Save failed");
        } finally {
          setSaving(false);
        }
      })();
    }
  }, [saveRequestKey, strategyId, initialNodes, initialEdges, onSaveSuccess, onSaveError]);

  const onNodesChangeWithDirty = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      hasUserChangedRef.current = true;
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

  const handleSaveClick = () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    save();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-2 py-2 border-b border-gray-800">
        {saveStatus === "saved" && (
          <span className="text-xs text-green-500">Saved</span>
        )}
        {saveStatus === "error" && (
          <span className="text-xs text-red-500">Error saving</span>
        )}
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-sm font-medium text-white"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWithDirty}
          onEdgesChange={onEdgesChangeWithDirty}
          onConnect={onConnect}
          nodeTypes={strategyNodeTypes}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
          className="bg-gray-950"
        >
          <Controls className="!bg-gray-900 !border-gray-700" />
          <MiniMap className="!bg-gray-900 !border-gray-700" />
          <Background gap={12} size={1} color="rgba(75,85,99,0.3)" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function StrategyCanvas({
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
  return (
    <ReactFlowProvider>
      <FlowCanvas
        strategyId={strategyId}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        onSaveSuccess={onSaveSuccess}
        onSaveError={onSaveError}
        onSavingChange={onSavingChange}
        saveRequestKey={saveRequestKey}
      />
    </ReactFlowProvider>
  );
}
