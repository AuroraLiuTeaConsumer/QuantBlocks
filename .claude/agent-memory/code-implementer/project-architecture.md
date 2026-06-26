---
name: project-architecture
description: QuantBlocks stack, key module locations, TimescaleDB vs Prisma split, migration workflow, and hard constraints
metadata:
  type: project
---

Stack: Next.js 15 App Router, TypeScript, Prisma 6 (PostgreSQL), TimescaleDB (same Postgres instance, raw SQL — NOT Prisma-managed), Node 24, tsx CLI runner, Vitest.

Key module locations:
- Redis client/channels: src/lib/redis/client.ts, src/lib/redis/channels.ts
- Paper trading engine: src/lib/paper/advance.ts (advanceSession), src/lib/paper/engine.ts
- Paper session registry: src/lib/paper/registry.ts (added in paper-worker phase)
- Market data types + resolveInstrument: src/lib/market-data/types.ts
- TimescaleDB repo (queryCandles method): src/lib/market-data/storage/timescale.repo.ts
- Background jobs: src/server/jobs/ (ws-ingest.job.ts, ingest-candles.job.ts, paper-worker.job.ts)
- Prisma schema: prisma/schema.prisma
- Raw SQL migrations for Prisma fields: db/migrations/prisma-raw/

TimescaleDB candle data lives in raw SQL schema (db/migrations/timescale/); NOT Prisma-managed.
Prisma-raw migrations: manual SQL files applied via `npx prisma db execute --stdin`, then `prisma migrate resolve --applied`, then `prisma generate`.

Hard constraints:
- NEVER run prisma migrate dev, prisma db execute, or prisma generate
- NEVER touch src/lib/strategy/engine/ — 25 passing tests depend on it
- NEVER change BacktestMetrics in src/lib/backtest/metrics.ts or SAMPLE_CANDLES in src/lib/data/candles.ts
- npx tsc --noEmit MUST pass clean; npm test MUST pass 25/25
- No new npm dependencies (ioredis already installed)

**Why:** Architecture was given as a fixed spec; engine tests are a regression guard for the strategy computation core.
**How to apply:** Always verify these constraints after any change. Never modify the protected files.
