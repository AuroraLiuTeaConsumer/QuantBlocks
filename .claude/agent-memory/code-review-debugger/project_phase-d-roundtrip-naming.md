---
name: phase-d-roundtrip-naming
description: Phase D series_compare/indicator_crossover round-trip risks — display-name vs indicatorId mapping gaps and dropped price field
metadata:
  type: project
---

Phase D added `indicator_crossover` and `series_compare` draft condition types plus multi-output handle fields (`indicatorOutput`, `indicatorOutputA/B`, `rightIndicator`, `rightParams`) flowing through draft <-> graph.

Non-obvious round-trip hazards found in review:
- `graph-to-draft.ts` writes back the indicator **display name** (`d.indicatorName`, e.g. "Prev High/Low") into `cond.indicator`. `draft-to-graph.ts` `nameToIndicatorId` then uppercases it and looks up `NAME_TO_ID`. "PREV HIGH/LOW" is NOT in that map -> falls through to `prev_high/low`, which `indicatorRegistry.get()` returns undefined for -> engine `evalNode` returns null -> condition silently never fires. Any indicator whose display name isn't in `NAME_TO_ID` is at risk. Safer: round-trip `indicatorId` directly.
- `series_compare` price-vs-band reconstruction drops the left price `field` (high/low/close). Re-conversion always emits `field:"close"`.

**Why:** these are silent (no crash, no warning) and only surface as a strategy that mysteriously never triggers after a canvas->draft->canvas round-trip.
**How to apply:** when reviewing changes to the AI builder pipeline, check that every indicator display name produced by graph-to-draft maps cleanly back through nameToIndicatorId, and that price field / output-handle selections survive the round-trip. Engine (runtime.ts/compile.ts) itself correctly supports same-source crossover and rightType:"series" — the risk is purely in the draft<->graph translation layer.

Related: [[graph-to-draft-lossy-traversal]], [[draft-graph-roundtrip-lossy]], [[validate-draft-warning-duplication]]
