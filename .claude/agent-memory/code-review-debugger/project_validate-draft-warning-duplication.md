---
name: validate-draft-warning-duplication
description: validateStrategyDraft seeds warnings from draft.warnings then pushes structural warnings unconditionally — duplicates accumulate across re-validation
metadata:
  type: project
---

`src/lib/ai/validate-draft.ts` initializes `warnings = [...draft.warnings]` then pushes structural warnings (overfit, no-risk, static-price-level, vague) with no dedupe. Because `mergeDraftUpdate` persists `draft.warnings` and the builder prompt also instructs the LLM to push similar warning strings, the same warning can accumulate every validation pass.

Also: the no-risk-management warning ignores `exitConditions`, producing a false-positive "unlimited downside risk" for valid exit-condition-based strategies (the earlier `hasExit` error check already treats exitConditions as a valid exit mechanism).

**Why:** Two sources (LLM-emitted + validator-computed) write into the same warnings list with no reconciliation.
**How to apply:** When reviewing validate-draft or builder-prompt changes, check for warning dedupe and that risk/exit warnings account for all exit mechanisms (stopLoss, takeProfit, exitConditions). Related: [[draft-graph-roundtrip-lossy]].
