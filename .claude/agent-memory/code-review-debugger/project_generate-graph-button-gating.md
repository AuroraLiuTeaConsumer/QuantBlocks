---
name: generate-graph-button-gating
description: Generate Graph button enablement must gate on draft completeness, not the LLM's nextAction hint (revision mode bug)
metadata:
  type: project
---

In `src/components/strategy/AiBuilderPanel.tsx`, the "Generate Graph" button's `canGenerate` must gate on `isDraftReady(conversation.draft)` alone, NOT require `nextAction === "ready_to_generate"`.

**Why:** Requiring the LLM hint left the button permanently disabled in two cases: (1) revision mode — the panel imports a complete draft from the canvas via `graphToStrategyDraft` and hardcodes `nextAction` to `"ask_clarification"`, with no path to flip it; (2) any turn where the LLM lags on emitting `ready_to_generate`. The draft can be fully complete while `nextAction` stays `"ask_clarification"`.

**How to apply:** The generate-graph route (`/api/ai/builder/generate-graph`) re-validates the draft server-side via `validateStrategyDraft`, so enabling the button on `isDraftReady` can never produce an invalid graph. Keep `nextAction` as a soft hint only. Relates to [[ai-builder-status-roundtrip]] (the "revising" status clobber) — same root theme: client-only state vs the server's narrow status/action set.
