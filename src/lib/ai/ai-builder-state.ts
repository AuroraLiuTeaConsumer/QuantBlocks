import type { StrategyDraft, MissingRequirement } from "@/types/ai-builder";

// ---------------------------------------------------------------------------
// Empty draft — the starting state before any requirements are collected
// ---------------------------------------------------------------------------

export const EMPTY_DRAFT: StrategyDraft = {
  entryConditions: [],
  confirmationConditions: [],
  exitConditions: [],
  filters: [],
  missingFields: [],
  assumptions: [],
  warnings: [],
};

// ---------------------------------------------------------------------------
// normalizeDraft
// Ensures all array fields are present and typed correctly after an LLM update.
// Defends against the LLM omitting fields or returning null instead of [].
// ---------------------------------------------------------------------------

export function normalizeDraft(raw: unknown): StrategyDraft {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DRAFT };
  const r = raw as Partial<StrategyDraft>;
  return {
    symbol: typeof r.symbol === "string" ? r.symbol : undefined,
    timeframe: typeof r.timeframe === "string" ? r.timeframe : undefined,
    direction: r.direction === "long" || r.direction === "short" || r.direction === "both"
      ? r.direction
      : undefined,
    entryConditions: Array.isArray(r.entryConditions) ? r.entryConditions : [],
    confirmationConditions: Array.isArray(r.confirmationConditions) ? r.confirmationConditions : [],
    exitConditions: Array.isArray(r.exitConditions) ? r.exitConditions : [],
    riskRules: r.riskRules && typeof r.riskRules === "object" ? r.riskRules : undefined,
    filters: Array.isArray(r.filters) ? r.filters : [],
    missingFields: Array.isArray(r.missingFields) ? r.missingFields : [],
    assumptions: Array.isArray(r.assumptions) ? r.assumptions : [],
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
  };
}

// ---------------------------------------------------------------------------
// mergeDraftUpdate
// Merges a partial draftUpdate from the LLM into the current draft.
// Arrays replace entirely when provided (LLM owns the full list for that field).
// Scalar fields replace when present (including explicit undefined to clear a field).
// missingFields always comes from the LLM API response, not recomputed client-side.
// ---------------------------------------------------------------------------

export function mergeDraftUpdate(
  current: StrategyDraft,
  update: Partial<StrategyDraft>
): StrategyDraft {
  const next = { ...current };

  if (typeof update.symbol === "string") next.symbol = update.symbol;
  if (typeof update.timeframe === "string") next.timeframe = update.timeframe;
  if (update.direction === "long" || update.direction === "short" || update.direction === "both") next.direction = update.direction;

  if ("riskRules" in update) {
    next.riskRules = update.riskRules
      ? { ...current.riskRules, ...update.riskRules }
      : undefined;
  }

  if (Array.isArray(update.entryConditions)) next.entryConditions = update.entryConditions;
  if (Array.isArray(update.confirmationConditions)) next.confirmationConditions = update.confirmationConditions;
  if (Array.isArray(update.exitConditions)) next.exitConditions = update.exitConditions;
  if (Array.isArray(update.filters)) next.filters = update.filters;

  // These always come authoratively from the LLM API response
  if (Array.isArray(update.missingFields)) next.missingFields = update.missingFields;
  if (Array.isArray(update.assumptions)) next.assumptions = update.assumptions;
  if (Array.isArray(update.warnings)) next.warnings = update.warnings;

  return next;
}

// ---------------------------------------------------------------------------
// isDraftReady
// Authoritative gate for the "Generate Graph" button and the generate-graph API call.
// The generate-graph route re-validates server-side, so enabling on structural
// completeness alone can never produce an invalid graph.
// ---------------------------------------------------------------------------

export function isDraftReady(draft: StrategyDraft): boolean {
  return (
    !!draft.symbol &&
    !!draft.timeframe &&
    !!draft.direction &&
    draft.entryConditions.length > 0 &&
    (draft.exitConditions.length > 0 || !!draft.riskRules?.stopLoss)
  );
}

// ---------------------------------------------------------------------------
// requiredMissingCount — convenience for UI progress display
// ---------------------------------------------------------------------------

export function requiredMissingCount(missingFields: MissingRequirement[]): number {
  return missingFields.filter((f) => f.priority === "required").length;
}
