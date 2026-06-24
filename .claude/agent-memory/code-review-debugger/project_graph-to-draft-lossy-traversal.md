---
name: graph-to-draft-lossy-traversal
description: graph-to-draft.ts reverse converter has order-dependent compare-source resolution, drops series thresholds, flattens AND/OR, and overwrites multiple set_risk nodes
metadata:
  type: project
---

`src/lib/ai/graph-to-draft.ts` (revision-mode importer) reverse-engineers a StrategyDraft from a StrategyGraph. Known silent-loss / correctness issues found in review:

- compare source picked via `reverseAdj.get(nodeId)[0]` (edge array order), NOT by targetHandle — can grab wrong operand. Contrast `buildCrossCondition` which correctly resolves the `b` handle.
- All compare branches hardcode `thresholdType: "fixed"` and read only `rightValue`; `rightType:"series"` comparisons lose the right-hand series and render "… > ?".
- `and`/`or` both flatten into a flat condition list — OR semantics (used by draft-to-graph for exits) silently become AND on round-trip.
- Multiple `set_risk` nodes: loop overwrites, keeps only last. An empty set_risk yields a truthy `{stopLoss:undefined,takeProfit:undefined}` that defeats `!riskRules` guards.
- Crossover with unresolved `b` input fabricates SMA(20) and assumes Price-vs-indicator, with no warning (unlike the NOT-gate case which does warn).

**Why:** The file's docstring accepts lossiness for "AI reasoning context," but several cases are silent (no warning) and a few are outright wrong, not just lossy.
**How to apply:** When reviewing graph-to-draft or any draft<->graph round-trip change, verify handle-based operand resolution and warnings on lossy branches. Related: [[draft-graph-roundtrip-lossy]], [[ai-builder-status-roundtrip]].
