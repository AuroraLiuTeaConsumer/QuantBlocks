---
name: codebase-patterns
description: Job file conventions, Prisma pre-migration cast pattern, queryCandles usage, candleChannel encoding, and registry pattern
metadata:
  type: project
---

Job file structure (copy from ws-ingest.job.ts):
1. .env loader block FIRST (before all imports) — manually parses .env.local then .env, sets process.env keys only if not already set
2. Imports after the loader block
3. SIGTERM/SIGINT handlers for graceful shutdown

Prisma pre-migration cast pattern (historical — cleaned up in June 2026):
- When a migration has NOT been applied yet, the generated Prisma client lacks the new fields
- Use `(session as any).mode` with TODO comment referencing the migration name
- Do NOT include unmigrated fields in typed `select` objects — causes TS errors
- Once `prisma generate` is re-run after migration, remove all casts and push the filter into the `where` clause
- The `mode` field casts in registry.ts and paper-worker.job.ts were removed in the June 2026 cleanup

queryCandles:
- NOT a standalone exported function — it's a method on the repo instance
- Usage: `const repo = getTimescaleRepo(); const candles = await repo.queryCandles({ exchange, symbol, timeframe, startTime, endTime, limit })`
- `exchange` must be typed as `Exchange` (union: binance|bybit|okx|hyperliquid)
- `timeframe` must be typed as `Timeframe` (union: 1m|3m|5m|15m|30m|1h|4h|1d)
- Always validate with `resolveInstrument()` and `isTimeframe()` before calling
- Import: `import { getTimescaleRepo } from "../../lib/market-data/storage/timescale.repo"`

candleChannel:
- `candleChannel(exchange, symbol, timeframe)` returns `candles:${exchange}:${encodeURIComponent(symbol)}:${timeframe}`
- Note: symbol is URL-encoded in the channel name (BTC/USDT:USDT → BTC%2FUSDT%3AUSDT)

resolveInstrument:
- Located in src/lib/market-data/types.ts
- Returns `InstrumentMapping | null` where InstrumentMapping = { exchange: Exchange, symbol: string }
- Instrument IDs like "BTC-PERP" map to { exchange: "binance", symbol: "BTC/USDT:USDT" }

Worker-mode sessions vs poll-mode:
- poll-mode sessions: auto-stop when candles.length === 0 (caught up to live tip)
- worker-mode sessions: NEVER auto-stop; return running snapshot unchanged when candles.length === 0
- mode is chosen at session start by probing Redis with isRedisAvailable() (500ms timeout); "worker" if reachable, "poll" otherwise
- mode field on PaperSession defaults to 'poll' in the DB schema; actual default is "worker" when Redis is up
- isRedisAvailable() is exported from src/lib/redis/client.ts — checks REDIS_URL and races a ping() vs timeout

**Why:** Patterns observed across route handlers and job files in the paper trading subsystem.
**How to apply:** Follow these patterns whenever adding new job files or extending the paper trading pipeline.
