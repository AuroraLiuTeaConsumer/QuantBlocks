# QuantBlocks — Agent Handoff Document

## 1. Project Name and Product Goal

**QuantBlocks** — A browser-based strategy builder, backtester, and paper trading workspace for perpetual futures. Users describe strategies in natural language, AI translates them into a React Flow node graph, and the system backtests or live-paper-trades the graph against real market data from TimescaleDB.

One-liner: **Talk to build, visualize to verify, backtest to validate.**

---

## 2. Current Phase and Exact Goal

**Completed through Phase 5.** All MVP phases are done.

| Phase | Delivered |
|-------|-----------|
| 1–2 | Strategy CRUD, React Flow canvas, backtest engine, paper trading engine |
| 3 | Hyperliquid native provider, WebSocket live candle ingestion, real-bar paper trading (`useRealBars` / `barCursor`) |
| 4 | CoinGlass derivatives data — `liquidations` + `long_short_ratios` hypertables, ingestion services, API routes, coverage dashboard |
| 5 | Risk-adjusted metrics, funding cost, CSV export, 10-card metrics grid; strategy creation UX (`/strategies` New Strategy; POST/PUT without `validateGraph`) |

The project is in a clean, passing state. `npx tsc --noEmit` is clean. All 25 tests pass.

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, TypeScript) |
| Frontend | React 19, React Flow (`@xyflow/react`), Lightweight Charts v5 |
| Styling | Tailwind CSS v3 |
| App DB | PostgreSQL via Prisma 6 (Strategy, BacktestRun, Trade, PaperSession, PaperTrade, IngestionJob) |
| Market data DB | TimescaleDB (same PG instance, raw SQL hypertables — NOT managed by Prisma) |
| Exchange data | CCXT (Binance/Bybit/OKX), custom Hyperliquid REST provider, CoinGlass REST v2 |
| CLI jobs | `tsx` (TypeScript execution, no build step) |
| Tests | Vitest |
| Node | 24+ (native WebSocket, `findLastIndex`) |

---

## 4. What Has Already Been Implemented

### Strategy Engine (`src/lib/strategy/engine/`)
- Compiles React Flow graph → `CompiledGraph`; steps bar-by-bar; produces `TradeEvent[]`
- Node types: price, volume, rsi, compare, cross, and, or, not, constant, open_position, close_position, set_risk
- SL/TP intra-bar checking; edge-triggered open/close; no pyramiding

### Backtest (`src/lib/backtest/`)
- `backtest.ts` — simulation loop; fills at bar open; accumulates `cumulativeFees` + `cumulativeFundingCost`
- `metrics.ts` — `computeMetrics()` producing 13 fields: totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, avgWin, avgLoss, profitFactor, sharpe, sortino, calmar, benchmarkReturnPct, fundingCostPaid
- `funding.ts` — `barFundingCost()` applies per-bar funding deductions when position open
- `data-loader.ts` — `BacktestDataLoader` queries TimescaleDB; falls back to SAMPLE_CANDLES at <80% coverage

### Paper Trading (`src/lib/paper/engine.ts`, `src/app/api/paper/`)
- `PaperSession` in Prisma; poll route advances engine per GET; optimistic lock on update
- Real-bar replay only from TimescaleDB via `barCursor` (synthetic random-walk removed); `useRealBars` always true on new sessions
- Mount resume: GET `/api/strategies/:id/paper/session` + `PaperTradingPanel` restores running/stopped sessions on load
- `barCursor` defaults to `session.startedAt − 90 days` (not epoch) when null

### Market Data (`src/lib/market-data/`)
- **Providers**: `CCXTProvider` (Binance/Bybit/OKX), `NativeHyperliquidProvider` (REST), `CoinGlassProvider` (liquidations + L/S ratios; requires `COINGLASS_API_KEY`)
- **Ingestion services**: historical candles (gap detection + quality checks + rate limiting), funding rates, open interest, liquidations, long/short ratios
- **TimescaleDB hypertables**: `candles`, `funding_rates`, `open_interest`, `liquidations`, `long_short_ratios`
- **CLI jobs**: `npm run ingest` (backfill), `npm run ws:ingest` (Binance USDT-M WebSocket live feed)

### API Routes (`src/app/api/`)
- Full CRUD for strategies — POST requires `name` only (optional nodes/edges); PUT saves canvas without graph validation; `validateGraph` runs on backtest start and AI translate only
- Backtest trigger + poll; paper session lifecycle (session GET, start/stop/reset/poll/trades)
- `GET /api/backtests/:runId/export` — CSV download (METRICS + TRADES + EQUITY_CURVE sections)
- Market data: candles, funding rates, open interest, liquidations, long/short ratios — each has GET (query) + POST (trigger ingest)
- `POST /api/market-data/ingest` — unified entry point; supports `dataType`: candle | funding_rate | open_interest | liquidation | long_short

### UI (`src/app/strategies/`, `src/components/strategy/`)
- `/strategies` list page — "New Strategy" button, inline name form, POST create with empty graph
- `StrategyWorkspace` → `StrategyCanvas` (React Flow) + `AiPromptPanel` + `BacktestPanel` + `PaperTradingPanel`
- `BacktestPanel`: 10-card metrics grid (5×2), equity curve chart, trades table, "Export CSV" button
- `PaperTradingPanel`: auto-resume on mount, start/stop/reset, replay-from date picker, TwoPaneChart streaming
- `/market-data` server-side coverage dashboard: candles, funding rates, OI, liquidations, L/S ratios, jobs

---

## 5. Current Folder Structure

```
src/
├── __tests__/            # Vitest: validator, engine, backtest (25 tests)
├── app/
│   ├── api/
│   │   ├── ai/translateStrategy/       # claude-sonnet-4-6 + validateGraph + retry
│   │   ├── backtests/[runId]/          # GET run, GET trades, GET export
│   │   ├── market-data/                # candles, coverage, funding-rates, ingest,
│   │   │                               #   jobs, liquidations, long-short-ratios, OI
│   │   ├── paper/[sessionId]/          # GET poll, POST stop/reset, GET trades
│   │   └── strategies/                 # CRUD + [id]/bars + [id]/backtests + [id]/paper/{start,session}
│   ├── market-data/page.tsx            # Coverage dashboard (server component)
│   └── strategies/                     # List page + [id] workspace page
├── components/strategy/                # All UI panels and chart components
├── lib/
│   ├── backtest/                       # backtest.ts, metrics.ts, funding.ts, data-loader.ts
│   ├── data/candles.ts                 # SAMPLE_CANDLES fallback (60 synthetic bars)
│   ├── market-data/
│   │   ├── ingestion/                  # One service per data type
│   │   ├── providers/                  # ccxt, hyperliquid, coinglass, registry
│   │   ├── storage/timescale.repo.ts   # All TimescaleDB reads/writes
│   │   └── types.ts                    # Candle, FundingRate, OI, Liquidation, L/S, INSTRUMENT_MAP
│   ├── paper/engine.ts                 # SessionRow → SessionSnapshot, toSnapshot()
│   ├── prisma.ts                       # Global PrismaClient singleton
│   └── strategy/
│       ├── engine/                     # compile.ts, runtime.ts, types.ts, indicators/
│       ├── graphTypes.ts
│       └── validator.ts
└── server/jobs/
    ├── ingest-candles.job.ts           # CLI: backfill all data types
    └── ws-ingest.job.ts                # CLI: Binance USDT-M WebSocket live feed

prisma/
├── schema.prisma                       # Strategy, BacktestRun, Trade, PaperSession, PaperTrade, IngestionJob
├── migrations/                         # 5 migrations, all applied
└── seed.ts

db/migrations/timescale/               # Raw SQL: 001–005 (candles, FR, OI, liquidations, L/S)
docs/                                  # ARCHITECTURE.md, BACKEND.md, BACKTEST.md, DATA_MODEL.md,
                                       # DEVELOPMENT.md, TODO.md, PAPER_TRADING.md, SPEC.md, etc.
scripts/setup-timescale.ts             # Runs all db/migrations/timescale/*.sql in order
```

---

## 6. Important Files and Their Responsibilities

| File | Responsibility |
|------|---------------|
| `src/lib/strategy/engine/runtime.ts` | Core step() loop — do not change without running all 25 tests |
| `src/lib/backtest/backtest.ts` | Simulation loop; imports from metrics.ts and funding.ts |
| `src/lib/backtest/metrics.ts` | `computeMetrics()` — all 13 backtest metrics including risk ratios |
| `src/lib/backtest/funding.ts` | `barFundingCost()` — per-bar funding deduction |
| `src/lib/market-data/storage/timescale.repo.ts` | All TimescaleDB reads/writes; singleton via `getTimescaleRepo()` |
| `src/lib/market-data/types.ts` | All domain types + `INSTRUMENT_MAP` + `TIMEFRAME_MS` |
| `src/app/api/strategies/[id]/backtests/route.ts` | Loads candles + funding rates; calls `runBacktest`; persists result |
| `src/app/api/paper/[sessionId]/route.ts` | Poll route; advances engine; optimistic lock; real-bar cursor advancement |
| `src/app/api/strategies/[id]/paper/session/route.ts` | GET latest running/stopped session for mount resume |
| `src/app/api/strategies/[id]/paper/start/route.ts` | Creates PaperSession (always real bars); returns existing running session |
| `src/components/strategy/BacktestPanel.tsx` | 10-card metrics grid; Export CSV button; equity chart |
| `src/components/strategy/PaperTradingPanel.tsx` | Uses `safeJson()` helper for all fetch calls |
| `prisma/schema.prisma` | App DB schema — do not run `prisma migrate dev` on a running DB (drifts with TimescaleDB raw tables) |
| `db/migrations/timescale/` | Raw SQL applied via `npm run setup:timescale` — idempotent (IF NOT EXISTS) |
| `src/server/jobs/ingest-candles.job.ts` | CLI entry point for all ingest types |

---

## 7. Current Known Bugs / Unfinished Tasks

| # | Item | Notes |
|---|------|-------|
| 5 | Paper execution only on poll | Expected limitation; advances only when client polls |
| ~~6~~ | ~~Session resume on tab switch~~ | ✅ Resolved — GET `/api/strategies/:id/paper/session` + panel mount restore |
| ~~7~~ | ~~AI stub~~ | ✅ Resolved — `POST /api/ai/translateStrategy` now calls `claude-sonnet-4-6`; one self-correction retry; requires `ANTHROPIC_API_KEY` |
| ~~8~~ | ~~Strategy creation UX~~ | ✅ Resolved — `/strategies` "New Strategy" button + name form; POST/PUT allow empty/incremental graphs |
| 9 | Optimistic lock retry | Paper session update can fail silently on concurrent polls |
| 10 | No auth / rate limiting | All API routes are unprotected |
| 17 | OI availability | `fetchOpenInterestHistory` not supported on all CCXT exchanges |
| 18 | Coverage dashboard refresh | Static server render; requires manual reload |
| 19 | Quality report in BacktestPanel | `QualityReport` in `IngestionJob.meta` but not displayed in UI |
| 26 | CoinGlass cross-exchange OI | Not yet ingested |

---

## 8. Commands to Run

```bash
# Install
npm install

# Start TimescaleDB
docker-compose up -d

# App DB (Prisma)
npx prisma migrate dev       # first time only
npx prisma db seed           # loads sample strategies

# TimescaleDB hypertables (run once; safe to re-run)
npm run setup:timescale

# Dev server
npm run dev                  # http://localhost:3000

# Tests
npm test                     # 25 tests, should all pass

# Type check
npx tsc --noEmit

# Ingest historical data
npm run ingest                                                  # BTC/USDT:USDT 1h 90d (Binance)
npm run ingest -- --exchange bybit --symbol "BTC/USDT:USDT"
npm run ingest -- --dataType funding_rate --days 365
npm run ingest -- --dataType open_interest --timeframe 1h
npm run ingest -- --dataType liquidation --symbol BTC --timeframe 1h   # requires COINGLASS_API_KEY
npm run ingest -- --dataType long_short --symbol BTC --timeframe 1d    # requires COINGLASS_API_KEY

# WebSocket live feed (Binance futures)
npm run ws:ingest
npm run ws:ingest -- --symbols BTCUSDT,ETHUSDT --timeframe 1m

# Prisma schema changes (IMPORTANT: do not use migrate dev for TimescaleDB tables)
# 1. Write raw ALTER TABLE SQL
# 2. npx prisma db execute --stdin < migration.sql
# 3. npx prisma migrate resolve --applied <migration-name>
# 4. npx prisma generate
```

---

## 9. Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string — used by both Prisma and TimescaleDB raw pool. Example: `postgresql://postgres:postgres@localhost:5432/quantblocks` |
| `COINGLASS_API_KEY` | No* | Required only for `liquidation` / `long_short` ingest types. Without it, those routes return 503 and CLI exits cleanly. All other functionality works without it. |

---

## 10. Non-Goals — What the Next Agent Must NOT Touch

- **Do not run `prisma migrate dev`** on any DB that already has TimescaleDB hypertables. It detects raw SQL tables as drift and will offer to reset the DB. Use the raw SQL + `prisma migrate resolve` pattern instead.
- **Do not refactor the strategy engine** (`src/lib/strategy/engine/`). It is stable and covered by tests. Any change risks breaking backtest/paper parity.
- **Do not change the `BacktestMetrics` interface** in `metrics.ts` without also updating: the backtest route's JSON persist call, `BacktestPanel.tsx`'s metric reads, and the CSV export's `metricLabels` map.
- **Do not change `SAMPLE_CANDLES`** in `src/lib/data/candles.ts` — the backtest tests use it for deterministic assertions.
- **Do not add new Prisma models or columns** without following the raw-SQL migration pattern above (ordinary `prisma migrate dev` will break the TimescaleDB coexistence).
- **Do not touch `timescale.repo.ts`** unless adding a new query — it is the single source of truth for all TimescaleDB access.
- **Do not introduce new npm dependencies** without a clear reason — the stack is intentionally minimal.

---

## 11. Next Immediate Task

All MVP phases are complete. The highest-value open items are:

**Item #9 — Optimistic lock retry**: The paper session poll update (`GET /api/paper/:sessionId`) can silently lose an update when two concurrent polls collide. Add a retry loop (≤3 attempts) around the Prisma update.

See `docs/TODO.md` for the full prioritised backlog.

---

## 12. Rules

1. **Minimal changes** — fix or add only what the task requires. Do not clean up surrounding code.
2. **No broad refactors** — the architecture is settled. Do not reorganize files or rename modules.
3. **Preserve the shared engine invariant** — backtest and paper trading must always use the same `lib/strategy/engine`. Never fork execution logic.
4. **Test before declaring done** — run `npm test` and `npx tsc --noEmit` after every change. Both must pass clean.
5. **Error handling at boundaries** — validate at API entry points; trust internal functions. Do not add defensive checks inside `metrics.ts`, `funding.ts`, or engine code.
6. **CoinGlass is optional** — any code path touching `CoinGlassProvider` must guard with `CoinGlassProvider.isConfigured()` and return 503 / exit gracefully when the key is absent.
7. **TimescaleDB migration protocol** — never `prisma migrate dev`; always raw SQL + `migrate resolve` + `prisma generate`.
8. **Docs must stay current** — after any non-trivial change, update the relevant file in `docs/` and move resolved items to the Resolved table in `TODO.md`.
