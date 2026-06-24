---
name: draft-graph-roundtrip-lossy
description: StrategyDraft<->StrategyGraph conversion is intentionally lossy; entry+confirmation merge into one AND gate, NOT gates and multi set_risk are dropped.
metadata:
  type: project
---

`src/lib/ai/draft-to-graph.ts` and `src/lib/ai/graph-to-draft.ts` form a lossy round-trip:

- `draft-to-graph` merges `entryConditions` + `confirmationConditions` into a single entry AND-gate, so the confirmation/entry distinction is gone on the way back (`graph-to-draft` can't recover it).
- `graph-to-draft` skips `not` gates (and their upstream subtree) with a warning — documented intentional gap.
- `graph-to-draft` overwrites `riskRules` per `set_risk` node, so multiple `set_risk` nodes silently lose all but the last.
- `cross` reverse-mapping keys off edge `targetHandle` `a`/`b` (matches draft-to-graph), but `compare` reverse-mapping uses `reverseAdj[0]` (first edge order, NOT handle) — fragile for 2-input series compares.
- `graph-to-draft` fabricates `SMA(period:20)` for crosses whose `b` source is neither `indicator` nor `rsi` — invents an indicator not in the graph.

**Why:** The reverse converter exists only to seed the AI revision conversation ("good enough for the AI to reason about"), not for exact reconstruction.

**How to apply:** Don't flag the entry/confirmation merge or NOT-gate skip as bugs — they're by design. DO scrutinize the compare-input-ordering assumption and the SMA(20) fabrication as real correctness risks. See [[ai-builder-status-roundtrip]].
