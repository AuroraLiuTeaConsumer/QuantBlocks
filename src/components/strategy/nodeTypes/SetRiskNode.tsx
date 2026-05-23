"use client";

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

export function SetRiskNode(props: NodeProps) {
  const { id, data } = props;
  const slPct = typeof data?.slPct === "number" ? data.slPct : undefined;
  const tpPct = typeof data?.tpPct === "number" ? data.tpPct : undefined;
  const { setNodes } = useReactFlow();

  const update = (updates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...updates } } : n
      )
    );
  };

  return (
    <BaseNode
      {...props}
      title="Set Risk"
      inputHandles={[{ id: "trigger" }]}
      outputHandle={false}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <label className="node-label w-7">SL%</label>
          <input
            type="number"
            step="0.1"
            min={0}
            placeholder="—"
            value={slPct ?? ""}
            onChange={(e) =>
              update({
                slPct:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            className="node-input w-14"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="node-label w-7">TP%</label>
          <input
            type="number"
            step="0.1"
            min={0}
            placeholder="—"
            value={tpPct ?? ""}
            onChange={(e) =>
              update({
                tpPct:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            className="node-input w-14"
          />
        </div>
      </div>
    </BaseNode>
  );
}
