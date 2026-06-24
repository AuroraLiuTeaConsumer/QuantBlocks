import type { StrategyDraft } from "@/types/ai-builder";

export type DraftValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const VALID_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export function validateStrategyDraft(draft: StrategyDraft): DraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [...draft.warnings];

  if (!draft.symbol?.trim()) {
    errors.push("Symbol is required (e.g. BTCUSDT)");
  }

  if (!draft.timeframe) {
    errors.push("Timeframe is required");
  } else if (!(VALID_TIMEFRAMES as readonly string[]).includes(draft.timeframe)) {
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
  }

  const hasExit =
    draft.exitConditions.length > 0 ||
    draft.riskRules?.stopLoss != null;

  if (!hasExit) {
    errors.push(
      "At least one exit mechanism is required (exit condition or stop loss rule)"
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
