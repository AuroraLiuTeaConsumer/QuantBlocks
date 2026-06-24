---
name: advance-idempotency-design
description: Phase 4 advance.ts idempotency design decisions — two-guard contract, source-agnostic boundary, auto-stop as caller policy
metadata:
  type: project
---

Phase 4 paper-trading streaming centers on `src/lib/paper/advance.ts` (`advanceSession(sessionId, bars[])`), the single advancement function called by the poll route, the worker fan-out, the replay pump, and the catch-up sweep.

**Two-guard idempotency contract (exactly-once per (session, openTime)):**
- Guard A: in-process cursor pre-filter — drop bars where `openTime <= barCursor`, against the freshly-read row, before the engine loop. `barCursor` (existing `DateTime?` column) IS the lastProcessedCandleTime; no new column.
- Guard B: optimistic write lock `updateMany({ where:{ id, updatedAt: prev, status:'running' } })`; on `count===0` re-read and re-run Guard A (bounded MAX_RETRIES=3, internal retry, never throw).
- Two concurrent callers CAN both pass Guard A on a stale cursor; that is correct — Guard B serialises, loser re-filters to a no-op. Filter = correctness guard, lock = serialization guard.

**Why these decisions (non-obvious, do not re-litigate):**
- `advance.ts` is SOURCE-AGNOSTIC: callers pass `bars`, advance.ts never fetches candles. Keeps the guards in one place across poll(TimescaleDB)/worker(Redis)/pump/sweep.
- Auto-stop-when-caught-up is a CALLER POLICY, not in advance.ts: `mode='poll'` auto-stops on catch-up; `mode='worker'` idles at `status='running'` indefinitely.
- Replay→live handoff uses cursor equality, NO completion flag (a flag creates a double/neither window). Requires pump and worker to share the same `openTime` clock from TimescaleDB.
- Sweep-vs-live: rely on Guard A+B + accept occasional wasted query for single-worker MVP. No DB lease layer. Optional advisory in-memory in-flight Set only.
- Trade persistence (collectTradeEvents/buildSessionUpdate/persistTrades) is lifted verbatim from the existing poll route inline block and runs in `$transaction` AFTER the lock is won; the session-row lock write is its own atomic `updateMany`.

Builds on [[project-constraints]] (reuse existing optimistic lock; raw-SQL migration; tsx jobs).
