---
name: project-constraints
description: QuantBlocks hard non-goals and migration protocol from HANDOFF.md — every architecture plan must respect these
metadata:
  type: project
---

Hard constraints from docs/HANDOFF.md (§10, §12) that any plan must honor.

**Why:** TimescaleDB raw hypertables coexist in the same Postgres instance as Prisma-managed tables; the engine is the shared backtest/paper invariant covered by 25 tests.

**How to apply:** When designing any Phase 4+ feature:
- Never `prisma migrate dev`. New Prisma columns = raw `ALTER TABLE` SQL via `prisma db execute --stdin` + `prisma migrate resolve --applied <name>` + `prisma generate`.
- Do NOT modify `src/lib/strategy/engine/` — consume `compileGraph`/`step`/`createInitialState` only.
- Do NOT change the `BacktestMetrics` interface.
- PaperSession already has optimistic locking via `updateMany({where:{id, updatedAt: prev}})` — reuse it for concurrent writers.
- New npm deps allowed only if justified; minimal preferred. `ioredis` is NOT yet installed.
- TimescaleDB access goes only through `getTimescaleRepo()` (`timescale.repo.ts`).
- CLI jobs run via `tsx` (no build step), live in `src/server/jobs/`, load .env manually at top of file.
