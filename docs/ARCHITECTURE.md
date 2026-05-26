# Architecture

## Overview

QuantBlocks is a full-stack Next.js application. Frontend and API routes run in the same process. No background workers; paper trading advances via polling.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │ StrategyCanvas│  │ BacktestPanel │  │ PaperTradingPanel      │    │
│  │ (React Flow)  │  │ (poll run)    │  │ (poll session+trades)  │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘    │
│         │                 │                      │                  │
└─────────┼─────────────────┼──────────────────────┼──────────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js (App Router)                                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ API Routes: /api/strategies, /api/backtests, /api/paper,         ││
│  │             /api/ai/translateStrategy, /api/market-data/*        ││
│  │             /api/strategies/:id/bars, backtests, paper/start     ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────────────┐ │
│  │ lib/strategy  │ │ lib/backtest    │ │ lib/market-data          │ │
│  │ validator     │ │ backtest.ts     │ │ providers/ccxt.provider  │ │
│  │ graphTypes    │ │ data-loader.ts  │ │ ingestion/historical-svc │ │
│  │ engine/*      │ │                 │ │ storage/timescale.repo   │ │
│  └───────────────┘ └─────────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          ▼                                         ▼
┌──────────────────────────┐      ┌──────────────────────────────────┐
│  Prisma → PostgreSQL     │      │  TimescaleDB (same PG instance)  │
│  Strategy, BacktestRun,  │      │  candles hypertable              │
│  Trade, PaperSession,    │      │  exchange, symbol, timeframe,    │
│  PaperTrade, IngestionJob│      │  open_time, OHLCV                │
└──────────────────────────┘      └──────────────────────────────────┘
```

## Frontend Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| StrategyWorkspace | `components/strategy/StrategyWorkspace.tsx` | Layout, tabs, apply/cancel draft |
| StrategyCanvas | `components/strategy/StrategyCanvas.tsx` | React Flow graph, autosave, node types |
| AiPromptPanel | `components/strategy/AiPromptPanel.tsx` | AI prompt UI, calls translateStrategy |
| BacktestPanel | `components/strategy/BacktestPanel.tsx` | Run backtest, poll run, metrics, chart, trades, data source badge |
| PaperTradingPanel | `components/strategy/PaperTradingPanel.tsx` | Start/stop/reset, poll session+trades, chart |
| TwoPaneChart | `components/strategy/TwoPaneChart.tsx` | Candlestick/line + equity, markers, streaming |
| nodeTypes | `components/strategy/nodeTypes/` | React Flow node components per graph type |

## Backend / API Modules

| Layer | Path | Responsibility |
|-------|------|----------------|
| Strategies API | `app/api/strategies/route.ts`, `[id]/route.ts` | CRUD strategies |
| Bars API | `app/api/strategies/[id]/bars/route.ts` | Real candles from TimescaleDB; synthetic fallback |
| Backtests API | `app/api/strategies/[id]/backtests/route.ts` | POST creates run; loads real candles via BacktestDataLoader |
| Backtest run | `app/api/backtests/[runId]/route.ts`, `trades/route.ts` | GET run, GET trades |
| Paper start | `app/api/strategies/[id]/paper/start/route.ts` | Create/resume session |
| Paper poll | `app/api/paper/[sessionId]/route.ts` | GET advances session (simulated bars, step engine) |
| Paper stop/reset | `app/api/paper/[sessionId]/stop`, `reset/route.ts` | Stop session, reset to idle |
| Paper trades | `app/api/paper/[sessionId]/trades/route.ts` | GET trades |
| Market data candles | `app/api/market-data/candles/route.ts` | GET candles from TimescaleDB |
| Market data ingest | `app/api/market-data/ingest/route.ts` | POST triggers ad-hoc CCXT ingestion |
| AI translate | `app/api/ai/translateStrategy/route.ts` | **Stub**: always returns RSI graph |

## Market Data Layer

```
CCXT (Binance USDT-perp)
    └── CCXTProvider.fetchCandles()
          └── HistoricalDataIngestionService.ingest()
                ├── GapDetector.detectGaps()         — find missing time ranges
                ├── RateLimiter                       — sliding window, 70% of RPM
                └── TimescaleRepository.insertCandles() — ON CONFLICT DO NOTHING
                          │
                          ▼
                  TimescaleDB candles hypertable

BacktestDataLoader.load()
    └── TimescaleRepository.queryCandles()
          → if coverage ≥ 80%: return real candles
          → else: throw InsufficientDataError → route falls back to SAMPLE_CANDLES
```

## Persistence Model

- **Strategy**: nodes, edges (JSON); instrument, timeframe, metadata.
- **BacktestRun**: status, metrics, log (equityCurve, debugEvents, dataSource, dataSourceLabel).
- **Trade**: runId, side, entry/exit, qty, pnl, reasonOpen/Close.
- **PaperSession**: status, engineState (JSON), equity, position, lastPrice.
- **PaperTrade**: sessionId, side, qty, entry/exit, pnl.
- **IngestionJob**: exchange, symbol, timeframe, status, rowsInserted, meta.
- **candles** (TimescaleDB hypertable): exchange, symbol, timeframe, open_time, OHLCV.

## Strategy Graph Flow

1. **Save**: StrategyCanvas → PUT `/api/strategies/:id` → `validateGraph` → Prisma update.
2. **Backtest**: BacktestPanel → POST `/api/strategies/:id/backtests` → `BacktestDataLoader.load()` → real candles (or SAMPLE_CANDLES fallback) → `runBacktest` (shared engine) → trades persisted.
3. **Paper**: PaperTradingPanel → POST `/api/strategies/:id/paper/start` → PaperSession created; GET `/api/paper/:sessionId` advances engine with simulated bars per poll.

## Polling-Based Execution Model

- **Backtest**: Synchronous; run completes before response.
- **Paper trading**: Execution happens on GET `/api/paper/:sessionId`. Elapsed time since `updatedAt` drives how many simulated bars to step. No background worker; client polls every 1s (session) and 3s (trades).

## Separation of Concerns

| Concern | Location |
|---------|----------|
| UI | `components/strategy/*` |
| Route handlers | `app/api/*` |
| Engine logic | `lib/strategy/engine/*`, `lib/backtest/backtest.ts` (fees/metrics wrapper) |
| Validation | `lib/strategy/validator.ts`, `lib/strategy/graphTypes.ts` (Zod) |
| Market data fetch | `lib/market-data/providers/ccxt.provider.ts` |
| Market data ingestion | `lib/market-data/ingestion/historical-service.ts` |
| Market data storage | `lib/market-data/storage/timescale.repo.ts` |
| Backtest data loading | `lib/backtest/data-loader.ts` |
| App DB access | `lib/prisma.ts`, Prisma models |
| TimescaleDB access | `lib/market-data/storage/timescale.client.ts` (pg.Pool singleton) |

## Current Weak Points / Technical Debt

1. **Paper bars still synthetic**: Paper trading uses random-walk bars. Phase 3 will replace with live Redis stream.
2. **No background worker**: Paper advances only when a client polls. Multiple tabs could cause duplicate advancement; optimistic lock mitigates but is imperfect.
3. **Session persistence**: Switching tabs (backtest ↔ paper) does not preserve paper session state in UI; session lives in DB but panel state resets.
4. **AI stub**: No real LLM; always same RSI strategy.
5. **Strategy creation UX**: No "New Strategy" UI — create via API or seed.
6. **Single instrument ingested by default**: Only BTC-PERP/1h unless `npm run ingest -- --symbol` is called for others.
