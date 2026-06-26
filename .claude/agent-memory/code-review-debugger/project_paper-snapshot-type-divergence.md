---
name: paper-snapshot-type-divergence
description: Two SessionSnapshot types (engine vs PaperTradingPanel local) diverge — engine lacks lastBar; SSE path casts across them.
metadata:
  type: project
---

There are two `SessionSnapshot` types: the engine one (`src/lib/paper/engine.ts`, no `lastBar`, `status: string`) and a local one in `src/components/strategy/PaperTradingPanel.tsx` (~line 21, has optional `lastBar`). `toSnapshot()` produces the engine shape; the poll endpoint `/api/paper/[sid]` separately attaches `lastBar`.

**Why:** The SSE route (`src/app/api/paper/[sessionId]/stream/route.ts`) emits `toSnapshot(row)` (engine shape, no `lastBar`) but `usePaperStream`'s consumer casts `as unknown as SessionSnapshot` (local) and calls `appendFromSnapshot`, where `snap.lastBar` is always undefined → candle never appended on SSE path. The cast silences the compiler that would have caught the divergence.

**How to apply:** When reviewing paper-trading snapshot code, check which `SessionSnapshot` is in play and whether `lastBar` survives the path. Treat `as unknown as` casts between these two as a smell. Same structural-typing trap family as [[project_quality-report-duplication]].
