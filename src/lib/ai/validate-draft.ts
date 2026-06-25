import type { StrategyDraft, StrategyDraftCondition } from "@/types/ai-builder";
import { TIMEFRAME_MS } from "@/lib/market-data/types";

export type DraftValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// Derived from the market-data registry so this list stays in sync with what
// the system can actually ingest/backtest — no separate hardcoded duplicate.
const VALID_TIMEFRAMES = Object.keys(TIMEFRAME_MS);

// A condition is convertible if draft-to-graph.ts can produce a real node for it.
// Custom conditions are convertible only when they carry an indicator + comparator.
function isConvertible(cond: StrategyDraftCondition): boolean {
  if (cond.type !== "custom") return true;
  return !!(cond.indicator && cond.comparator);
}

export function validateStrategyDraft(draft: StrategyDraft): DraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.symbol?.trim()) {
    errors.push("Symbol is required (e.g. BTCUSDT)");
  }

  if (!draft.timeframe) {
    errors.push("Timeframe is required");
  } else if (!VALID_TIMEFRAMES.includes(draft.timeframe)) {
    errors.push(
      `Invalid timeframe "${draft.timeframe}". Must be one of: ${VALID_TIMEFRAMES.join(", ")}`
    );
  }

  if (!draft.direction) {
    errors.push("Direction is required (long, short, or both)");
  }

  if (draft.entryConditions.length === 0) {
    errors.push("At least one entry condition is required");
  } else {
    for (const cond of draft.entryConditions) {
      if (!cond.description) {
        errors.push("An entry condition is missing a description");
      }
    }
    const convertibleCount = draft.entryConditions.filter(isConvertible).length;
    if (convertibleCount === 0) {
      errors.push(
        "No entry conditions can be converted to graph nodes. " +
        "Custom conditions require an indicator and comparator — or use indicator_threshold, " +
        "crossover, price_level, volume_spike, indicator_crossover, or series_compare types."
      );
    }
  }

  const hasExit =
    draft.exitConditions.length > 0 ||
    draft.riskRules?.stopLoss != null;

  if (!hasExit) {
    errors.push(
      "At least one exit mechanism is required (exit condition or stop loss rule)"
    );
  }

  // ── Structural warnings (non-blocking) ──────────────────────────────────

  // Overfit risk: too many entry conditions
  if (draft.entryConditions.length > 3) {
    warnings.push(
      `${draft.entryConditions.length} entry conditions is high — complex entry criteria can overfit to historical data. Consider simplifying to 2–3 conditions.`
    );
  }

  // Vague logic: unconvertible custom conditions
  const vagueConds = draft.entryConditions.filter(
    (c) => c.type === "custom" && !isConvertible(c)
  );
  for (const c of vagueConds) {
    warnings.push(
      `Entry condition "${c.description}" is too vague to convert automatically — define a specific indicator and threshold.`
    );
  }

  // No risk management: neither stop loss, take profit, nor explicit exit conditions
  if (!draft.riskRules?.stopLoss && !draft.riskRules?.takeProfit && draft.exitConditions.length === 0) {
    warnings.push(
      "No stop loss, take profit, or exit condition defined. Unlimited downside risk — consider adding a stop loss before backtesting."
    );
  }

  // Price-level entry: specific constant thresholds can overfit to price history
  const hasStaticPriceLevel = draft.entryConditions.some(
    (c) => c.type === "price_level" && typeof c.threshold === "number" && c.threshold !== 0
  );
  if (hasStaticPriceLevel) {
    warnings.push(
      "Static price-level entry (e.g. close > 50000) will only trigger once around that price. " +
      "Consider a dynamic entry using an indicator or percentage breakout instead."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
