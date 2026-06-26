---
name: paper-advance-concurrency
description: Paper-trading advanceSession concurrency contract (optimistic lock + cursor pre-filter) and the regression risk when refactoring the poll path.
metadata:
  type: project
---

`advanceSession` in `src/lib/paper/advance.ts` (extracted from `src/app/api/paper/[sessionId]/route.ts`) advances a paper session by replaying candles. Two concurrency guards:
- Guard A: cursor pre-filter — drops candidate bars whose openTime <= session.barCursor.
- Guard B: optimistic lock — `updateMany` where `updatedAt === session.updatedAt AND status === "running"`; count 0 means a concurrent poll won.

**Why:** concurrent client polls race to advance the same session; without these guards bars get double-processed (duplicate trades / wrong PnL).

**How to apply:** When reviewing changes to this path, watch for:
- candle fetch happening ONCE before the retry loop (route.ts) vs. inside it (old committed version re-fetched a fresh batch per retry). Reusing the same candidateBars means a collision loser returns noop instead of processing the next batch — self-heals via client re-poll but is a behavior change.
- noop / lock-lost branches returning the pre-advance `session` snapshot (stale) instead of re-reading after a concurrent winner commits.
- compile-error response dropping `compiled.errors` detail (the AdvanceResult compile-error variant carries no payload).

Related: [[project_quality-report-duplication]] — same codebase habit of duplicated structural types (RealBar in route.ts vs AdvanceBar in advance.ts).
