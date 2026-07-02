---
name: project-architecture
description: QuantBlocks stack, key module locations, TimescaleDB vs Prisma split, migration workflow, and hard constraints
metadata:
  type: project
---

Stack: Next.js 15 App Router, TypeScript, Prisma 6 (PostgreSQL), TimescaleDB (same Postgres instance, raw SQL — NOT Prisma-managed), Node 24, tsx CLI runner, Vitest.

Key module locations:
- Redis client/channels: src/lib/redis/client.ts (createRedisSubscriber, getRedisPublisher, isRedisAvailable), src/lib/redis/channels.ts (sessionChannel, candleChannel)
- Paper trading engine: src/lib/paper/advance.ts (advanceSession), src/lib/paper/engine.ts (toSnapshot, SessionRow, SessionSnapshot — includes mode + replaySpeed)
- Paper session registry: src/lib/paper/registry.ts (getActiveSessions, getWorkerSubscriptions — both filter by mode="worker" in the DB query)
- Market data types + resolveInstrument: src/lib/market-data/types.ts
- TimescaleDB repo (queryCandles method): src/lib/market-data/storage/timescale.repo.ts
- Background jobs: src/server/jobs/ (ws-ingest.job.ts, ingest-candles.job.ts, paper-worker.job.ts)
- Prisma schema: prisma/schema.prisma
- Prisma migrations directory: prisma/migrations/ (standard Prisma migration layout; raw SQL applied with `prisma db execute --file`, then `prisma migrate resolve --applied`)
- SSE stream route: src/app/api/paper/[sessionId]/stream/route.ts (force-dynamic, runtime=nodejs)
- SSE client hook: src/components/strategy/usePaperStream.ts (gated by NEXT_PUBLIC_PAPER_STREAM=true)

TimescaleDB candle data lives in raw SQL schema (db/migrations/timescale/); NOT Prisma-managed.
Prisma-raw migrations: manual SQL files applied via `npx prisma db execute --file <path>`, then `prisma migrate resolve --applied <name>`, then `prisma generate`.

Hard constraints:
- NEVER run `prisma migrate dev` or `prisma migrate reset` — would drop/reset TimescaleDB hypertables
- `prisma generate` is safe and should be run after schema changes
- NEVER touch src/lib/strategy/engine/ — 25 passing tests depend on it
- NEVER change BacktestMetrics in src/lib/backtest/metrics.ts or SAMPLE_CANDLES in src/lib/data/candles.ts
- npx tsc --noEmit MUST pass clean; npm test MUST pass 25/25
- No new npm dependencies (ioredis already installed)

**Why:** Architecture was given as a fixed spec; engine tests are a regression guard for the strategy computation core.
**How to apply:** Always verify these constraints after any change. Never modify the protected files.
