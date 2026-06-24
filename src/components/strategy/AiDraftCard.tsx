"use client";

import { useState } from "react";
import type { StrategyDraft, MissingRequirement } from "@/types/ai-builder";

type AiDraftCardProps = {
  draft: StrategyDraft;
};

export function AiDraftCard({ draft }: AiDraftCardProps) {
  const [expanded, setExpanded] = useState(true);

  const hasAnyData =
    draft.symbol ||
    draft.timeframe ||
    draft.direction ||
    draft.entryConditions.length > 0 ||
    draft.exitConditions.length > 0 ||
    draft.riskRules;

  if (!hasAnyData) return null;

  const requiredMissing = draft.missingFields.filter((f) => f.priority === "required");

  return (
    <div className="mx-3 mb-2 mt-1 overflow-hidden rounded-lg border border-line bg-surface-alt text-xs">
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface"
      >
        <span className="flex-1 font-semibold text-ink-1">Strategy Draft</span>

        {requiredMissing.length > 0 ? (
          <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-semibold text-warn">
            {requiredMissing.length} missing
          </span>
        ) : (
          <span className="rounded-full bg-[var(--green-bg,#dcfce7)] px-2 py-0.5 text-[10px] font-semibold text-[var(--green,#16a34a)]">
            Complete
          </span>
        )}

        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-3 transition-transform"
          style={{ transform: expanded ? "none" : "rotate(-90deg)" }}
        >
          <path d="M2 4l3.5 3.5L9 4" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-line px-3 pb-3 pt-2 space-y-2.5">
          {/* Market */}
          <Section label="Market">
            <Row
              label="Symbol"
              value={draft.symbol}
              missing={!draft.symbol}
            />
            <Row
              label="Timeframe"
              value={draft.timeframe}
              missing={!draft.timeframe}
            />
            <Row
              label="Direction"
              value={draft.direction}
              missing={!draft.direction}
            />
          </Section>

          {/* Entry */}
          {(draft.entryConditions.length > 0 || draft.confirmationConditions.length > 0) && (
            <Section label="Entry">
              {draft.entryConditions.map((c, i) => (
                <ConditionRow key={c.description || `entry-${i}`} label="Entry" text={c.description} />
              ))}
              {draft.confirmationConditions.map((c, i) => (
                <ConditionRow key={c.description || `confirm-${i}`} label="Confirm" text={c.description} />
              ))}
            </Section>
          )}

          {/* Exit */}
          {(draft.exitConditions.length > 0 || draft.riskRules) && (
            <Section label="Exit">
              {draft.exitConditions.map((c, i) => (
                <ConditionRow key={c.description || `exit-${i}`} label="Exit" text={c.description} />
              ))}
              {draft.riskRules?.stopLoss && (
                <ConditionRow label="Stop" text={formatStopLoss(draft.riskRules.stopLoss)} />
              )}
              {draft.riskRules?.takeProfit && (
                <ConditionRow label="Target" text={formatTakeProfit(draft.riskRules.takeProfit)} />
              )}
              {draft.riskRules?.positionSizePct != null && (
                <ConditionRow label="Size" text={`${draft.riskRules.positionSizePct}% of equity`} />
              )}
            </Section>
          )}

          {/* Filters */}
          {draft.filters.length > 0 && (
            <Section label="Filters">
              {draft.filters.map((f, i) => (
                <ConditionRow key={f.description || `filter-${i}`} label={f.type} text={f.description} />
              ))}
            </Section>
          )}

          {/* Assumptions */}
          {draft.assumptions.length > 0 && (
            <Section label="Assumptions">
              {draft.assumptions.map((a) => (
                <div key={a} className="text-[11px] text-ink-2">
                  <span className="text-ink-3">•</span> {a}
                </div>
              ))}
            </Section>
          )}

          {/* Warnings */}
          {draft.warnings.length > 0 && (
            <Section label="Warnings">
              {draft.warnings.map((w) => (
                <div key={w} className="text-[11px] text-warn">
                  <span>⚠</span> {w}
                </div>
              ))}
            </Section>
          )}

          {/* Missing required fields */}
          {requiredMissing.length > 0 && (
            <Section label="Still needed">
              {requiredMissing.map((f) => (
                <MissingRow key={f.field} field={f} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  missing,
}: {
  label: string;
  value: string | undefined;
  missing?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="w-16 shrink-0 text-[10px] text-ink-3">{label}</span>
      <span className={`text-[11px] ${missing ? "text-ink-3 italic" : "font-medium text-ink-1"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function ConditionRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-px shrink-0 rounded bg-surface px-1 py-px text-[9px] font-semibold uppercase text-ink-3">
        {label}
      </span>
      <span className="text-[11px] leading-snug text-ink-1">{text}</span>
    </div>
  );
}

function MissingRow({ field }: { field: MissingRequirement }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      <span className="text-[11px] leading-snug text-ink-2">{field.question}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatStopLoss(sl: NonNullable<StrategyDraft["riskRules"]>["stopLoss"]): string {
  if (!sl) return "";
  if (sl.type === "pct") return `${sl.value ?? "?"}% below entry`;
  if (sl.type === "candle_low") return "Below signal candle low";
  if (sl.type === "atr") return `${sl.value ?? "?"}× ATR`;
  return "Stop loss";
}

function formatTakeProfit(tp: NonNullable<StrategyDraft["riskRules"]>["takeProfit"]): string {
  if (!tp) return "";
  if (tp.type === "pct") return `${tp.value ?? "?"}% above entry`;
  if (tp.type === "rr_ratio") return `${tp.value ?? "?"}R target`;
  if (tp.type === "atr") return `${tp.value ?? "?"}× ATR`;
  return "Take profit";
}
