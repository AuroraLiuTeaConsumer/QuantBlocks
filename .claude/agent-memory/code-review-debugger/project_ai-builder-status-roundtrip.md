---
name: ai-builder-status-roundtrip
description: AI Builder client conversationStatus can only round-trip values the server validator accepts; client-only statuses get clobbered on next turn.
metadata:
  type: project
---

The AI Strategy Builder (`src/components/strategy/AiBuilderPanel.tsx`) tracks `conversation.status`, but on every user message `sendMessage` overwrites it with the server's `conversationStatus`. The server (`src/app/api/ai/builder/message/route.ts` `isValidConversationStatus`) only accepts `"collecting_requirements"` and `"ready_to_generate"` — all other statuses (`"idle"`, `"revising"`, `"graph_generated"`, `"error"`) are client-only and get clobbered after one turn unless explicitly preserved client-side.

**Why:** Phase A keeps the server stateless and narrow; statuses like `"revising"` are set purely client-side (revision-mode init effect) but the send path blindly trusts the server value.

**How to apply:** When reviewing any feature that sets a client-only `status`, check that `sendMessage` (around line 199-201) preserves it across turns instead of overwriting with `conversationStatus ?? "collecting_requirements"`. Same trap exists for the `status === "idle"` guard.
