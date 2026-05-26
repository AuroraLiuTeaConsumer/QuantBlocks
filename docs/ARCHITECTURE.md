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
│  │             /api/ai/translateStrategy,                           ││
│  │             /api/market-data/{candles,ingest,coverage,jobs,      ││
│  │                               funding-rates,open-interest}       ││
│  │             /api/strategies/:id/{bars,backtests,paper/start}     ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────────────┐ │
│  │ lib/strategy  │ │ lib/backtest    │ │ lib/market-data          │ │
│  │ validator     │ │ backtest.ts     │ │ providers/{ccxt,base}    │ │
│  │ graphTypes    │ │ data-loader.ts  │ │ ingestion/{historical,   │ │
│  │ engine/*      │ │                 │ │  funding-rate,oi,quality}│ │
│  └───────────────┘ └─────────────────┘ │ storage/timescale.repo  │ │
│                                        └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          ▼                                         ▼
┌──────────────────────────┐      ┌──────────────────────────────────┐
│  Prisma → PostgreSQL     │      │  TimescaleDB (same PG instance)  │
│  Strategy, BacktestRun,  │      │  candles hypertable              │
│  Trade, PaperSession,    │      │  funding_rates hypertable        │
│  PaperTrade, IngestionJob│      │  open_interest hypertable        │
└──────────────────────────┘      └──────────────────────────────────┘
```

## Frontend Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| StrategyWorkspace | `components/strategy/StrategyWorkspace.tsx` | Layout, tabs, apply/cancel draft |
| StrategyCanvas | `components/strategy/StrategyCanvas.tsx` | React Flow graph, autosave, node types |
| AiPromptPanel | `components/strategy/AiPromptPanel.tsx` | AI prompt UI, calls translateStrategy |
| BacktestPanel | `components/strategy/BacktestPanel.tsx` | Run backtest, metrics, chart, data source badge |
| PaperTradingPanel | `components/strategy/PaperTradingPanel.tsx` | Start/stop/reset, poll session+trades, chart; Real Bars toggle + Replay From date |
| TwoPaneChart | `components/strategy/TwoPaneChart.tsx` | Candlestick/line + equity, markers, streaming |
| MarketDataPage | `app/market-data/page.tsx` | Coverage dashboard: candles, funding rates, OI, jobs |
| nodeTypes | `components/strategy/nodeTypes/` | React Flow node components per graph type |

## Backend / API Modules

| Layer | Path | Responsibility |
|-------|------|----------------|
| Strategies API | `app/api/strategies/route.ts`, `[id]/route.ts` | CRUD strategies |
| Bars API | `app/api/strategies/[id]/bars/route.ts` | Real candles from TimescaleDB; synthetic fallback |
| Backtests API | `app/api/strategies/[id]/backtests/route.ts` | POST creates run; loads real candles via BacktestDataLoader |
| Paper API | `app/api/strategies/[id]/paper/start`, `app/api/paper/[sessionId]/*` | Session lifecycle |
| Market data candles | `app/api/market-data/candles/route.ts` | GET candles from TimescaleDB |
| Market data ingest | `app/api/market-data/ingest/route.ts` | POST triggers ingestion (candle / funding_rate / open_interest) |
| Market data coverage | `app/api/market-data/coverage/route.ts` | GET summary of all stored series |
| Ingestion jobs | `app/api/market-data/jobs/route.ts` | GET recent IngestionJob records |
| Funding rates | `app/api/market-data/funding-rates/route.ts` | GET query + POST ingest |
| Open interest | `app/api/market-data/open-interest/route.ts` | GET query + POST ingest |
| AI translate | `app/api/ai/translateStrategy/route.ts` | **Stub**: always returns RSI graph |

## Market Data Layer

```
CCXT (Binance / Bybit / OKX USDT-perp)         Hyperliquid REST
    └── CCXTProvider                               └── NativeHyperliquidProvider
          ├── fetchCandles()                             ├── fetchCandles()
          ├── fetchFundingRates()                        ├── fetchFundingRates()
          └── fetchOpenInterest()                        └── fetchOpenInterest() → []

Registry (providers/registry.ts)
  exchange === 'hyperliquid' → NativeHyperliquidProvider
  otherwise                 → CCXTProvider

HistoricalDataIngestionService (candles)
  ├── GapDetector      — find missing candle ranges
  ├── QualityChecker   — validate OHLC, volume, spikes
  ├── RateLimiter      — sliding window, 70% of exchange RPM
  └── TimescaleRepository.insertCandles()

FundingRateIngestionService  → TimescaleRepository.insertFundingRates()
OpenInterestIngestionService → TimescaleRepository.insertOpenInterest()

WebSocket live ingestion (ws-ingest.job.ts)
  Binance USDT-M kline stream (native Node.js WebSocket)
  → TimescaleRepository.insertCandles() on each closed candle

                │
                ▼
        TimescaleDB hypertables:
          candles, funding_rates, open_interest

BacktestDataLoader.load()
    └── TimescaleRepository.queryCandles()
          → coverage ≥ 80%: return real candles
          → else: throw InsufficientDataError → fallback to SAMPLE_CANDLES

Paper trading real-bar replay
    └── TimescaleRepository.queryCandles(after=barCursor, limit=5)
          → feed real closed candles to strategy engine per poll
```

## Data Quality Pipeline

Every batch of candles from CCXT passes through `QualityChecker` before insert:
- OHLC consistency (`high ≥ max(open,close)`, `low ≤ min(open,close)`)
- Negative / zero prices
- Zero / negative volume
- Price spikes > 15% vs previous bar

Issues are logged as warnings but do **not** block ingestion. Aggregated `QualityReport` is returned in `IngestionResult`.

## Persistence Model

- **Strategy**: nodes, edges (JSON); instrument, timeframe.
- **BacktestRun**: status, metrics, log (equityCurve, debugEvents, dataSource, dataSourceLabel, quality).
- **Trade**: runId, side, entry/exit, qty, pnl.
- **PaperSession**: status, engineState (JSON), equity, position, `useRealBars` (boolean), `barCursor` (DateTime? — last replayed candle open_time).
- **PaperTrade**: sessionId, side, qty, entry/exit, pnl.
- **IngestionJob**: exchange, symbol, timeframe, dataType, status, rowsInserted, meta.
- **candles** (TimescaleDB): exchange, symbol, timeframe, open_time → OHLCV.
- **funding_rates** (TimescaleDB): exchange, symbol, funding_time, funding_rate, mark_price.
- **open_interest** (TimescaleDB): exchange, symbol, timeframe, ts, open_interest, open_interest_value.

## Strategy Graph Flow

1. **Save**: StrategyCanvas → PUT `/api/strategies/:id` → `validateGraph` → Prisma update.
2. **Backtest**: BacktestPanel → POST `/api/strategies/:id/backtests` → `BacktestDataLoader.load()` → real candles (or SAMPLE_CANDLES fallback) → `runBacktest` → trades persisted.
3. **Paper (synthetic)**: PaperTradingPanel → POST `/api/strategies/:id/paper/start` → PaperSession; GET `/api/paper/:sessionId` generates random-walk bars per poll.
4. **Paper (real bars)**: POST start with `{ useRealBars: true, replayFrom?: ISO }` → PaperSession with `useRealBars=true`; poll route fetches up to 5 real candles from TimescaleDB after `barCursor`; advances engine + updates cursor.

## Separation of Concerns

| Concern | Location |
|---------|----------|
| UI | `components/strategy/*`, `app/market-data/page.tsx` |
| Route handlers | `app/api/*` |
| Engine logic | `lib/strategy/engine/*`, `lib/backtest/backtest.ts` |
| Validation | `lib/strategy/validator.ts`, `lib/strategy/graphTypes.ts` |
| Market data fetch | `lib/market-data/providers/ccxt.provider.ts` |
| Data quality | `lib/market-data/ingestion/quality-checker.ts` |
| Candle ingestion | `lib/market-data/ingestion/historical-service.ts` |
| Funding rate ingestion | `lib/market-data/ingestion/funding-rate-service.ts` |
| OI ingestion | `lib/market-data/ingestion/open-interest-service.ts` |
| TimescaleDB access | `lib/market-data/storage/timescale.repo.ts` |
| Backtest data loading | `lib/backtest/data-loader.ts` |

## Current Weak Points / Technical Debt

1. **Paper bars still synthetic**: Paper trading uses random-walk bars. Phase 3 replaces with live Redis stream.
2. **No background worker**: Paper advances only when a client polls. Multiple tabs risk double-advancement (optimistic lock mitigates).
3. **Session persistence**: Paper panel state resets on tab switch; session lives in DB.
4. **AI stub**: No real LLM; always same RSI strategy.
5. **Strategy creation UX**: No "New Strategy" UI — create via API or seed.
6. **OI availability**: `fetchOpenInterestHistory` is not supported on all CCXT exchanges; service throws and ingestion job records the failure.
