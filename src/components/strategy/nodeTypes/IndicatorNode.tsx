"use client";

import type { NodeProps } from "@xyflow/react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { indicatorRegistry } from "@/lib/indicators/registry";
import type { IndicatorNodeConfig } from "@/lib/indicators/types";

/** Width of the indicator node in pixels — slightly wider than standard nodes to fit param labels. */
const NODE_WIDTH = 184;

export function IndicatorNode(props: NodeProps) {
  const { id, data, selected } = props;
  const { setNodes } = useReactFlow();

  const config = data as unknown as IndicatorNodeConfig;
  const indicatorId = config?.indicatorId ?? "sma";
  const params      = (config?.params as Record<string, number | string>) ?? {};
  const def         = indicatorRegistry.get(indicatorId);

  function patchData(patch: Partial<IndicatorNodeConfig>) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  }

  function updateParam(name: string, value: number | string) {
    patchData({ params: { ...params, [name]: value } });
  }

  function changeIndicator(newId: string) {
    const newDef = indicatorRegistry.get(newId);
    if (!newDef) return;
    const defaultParams = Object.fromEntries(
      newDef.parameters.map((p) => [p.name, p.default]),
    );
    patchData({ indicatorId: newId, params: defaultParams, indicatorName: newDef.name });
  }

  const outputs    = def?.outputs ?? [{ name: "value", label: "value", type: "number" as const }];
  const isSingle   = outputs.length === 1;

  // Distribute output handles evenly along the right edge.
  const handleTopPct = (i: number) =>
    outputs.length === 1 ? 50 : ((i + 1) / (outputs.length + 1)) * 100;

  return (
    <div
      className="overflow-hidden rounded-[9px] border bg-surface transition-shadow"
      style={{
        width: NODE_WIDTH,
        borderColor: selected ? "var(--purple)" : "var(--border)",
        borderWidth: 1.5,
        boxShadow: selected
          ? "0 0 0 3px var(--purple-bg), 0 2px 8px rgba(0,0,0,0.1)"
          : "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{
          background: "var(--purple-bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "var(--purple)" }}
        />
        <select
          value={indicatorId}
          onChange={(e) => changeIndicator(e.target.value)}
          className="nodrag flex-1 bg-transparent text-[11px] font-semibold leading-none outline-none"
          style={{ color: "var(--purple)" }}
        >
          {indicatorRegistry.getAll().map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Params ── */}
      {def && def.parameters.length > 0 && (
        <div className="nodrag space-y-1 px-2.5 py-1.5 text-xs">
          {def.parameters.map((param) => (
            <div key={param.name} className="flex items-center gap-1.5">
              <label className="node-label w-10 shrink-0 text-ink-3">{param.label}</label>
              {param.type === "select" ? (
                <select
                  value={String(params[param.name] ?? param.default)}
                  onChange={(e) => updateParam(param.name, e.target.value)}
                  className="node-select min-w-0 flex-1"
                >
                  {param.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.type === "float" ? "0.01" : "1"}
                  value={Number(params[param.name] ?? param.default)}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (Number.isNaN(raw)) return;
                    updateParam(
                      param.name,
                      param.type === "integer" ? Math.round(raw) : raw,
                    );
                  }}
                  className="node-input min-w-0 flex-1"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Multi-output labels ── */}
      {!isSingle && (
        <div
          className="border-t border-line px-2.5 pb-1 pt-0.5"
          style={{ paddingRight: 18 }} // leave room for handles
        >
          {outputs.map((out) => (
            <div key={out.name} className="py-0.5 text-right text-[10px] text-ink-3">
              {out.label}
            </div>
          ))}
        </div>
      )}

      {/* ── Handles ── */}
      {outputs.map((out, i) => (
        <Handle
          key={out.name}
          type="source"
          position={Position.Right}
          id={isSingle ? "out" : out.name}
          style={{ top: `${handleTopPct(i)}%` }}
        />
      ))}
    </div>
  );
}
