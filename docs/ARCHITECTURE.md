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
│  │             /api/backtests/:runId/export,                        ││
│  │             /api/ai/translateStrategy,                           ││
│  │             /api/market-data/{candles,ingest,coverage,jobs,      ││
│  │                               funding-rates,open-interest,       ││
│  │                               liquidations,long-short-ratios}    ││
│  │             /api/strategies/:id/{bars,backtests,paper/start,session}││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────────────┐ │
│  │ lib/strategy  │ │ lib/backtest    │ │ lib/market-data          │ │
│  │ validator     │ │ backtest.ts     │ │ providers/{ccxt,base,    │ │
│  │ graphTypes    │ │ data-loader.ts  │ │          coinglass}      │ │
│  │ engine/*      │ │ metrics.ts      │ │ ingestion/{historical,   │ │
│  │               │ │ funding.ts      │ │  funding-rate,oi,        │ │
│  └───────────────┘ └─────────────────┘ │  liquidation,long-short, │ │
│                                        │  quality}                │ │
│                                        │ storage/timescale.repo   │ │
│                                        └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          ▼                                         ▼
┌──────────────────────────┐      ┌──────────────────────────────────┐
│  Prisma → PostgreSQL     │      │  TimescaleDB (same PG instance)  │
│  Strategy, BacktestRun,  │      │  candles hypertable              │
│  Trade, PaperSession,    │      │  funding_rates hypertable        │
│  PaperTrade, IngestionJob│      │  open_interest hypertable        │
│                          │      │  liquidations hypertable         │
│                          │      │  long_short_ratios hypertable    │
└──────────────────────────┘      └──────────────────────────────────┘
```

## Frontend Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| StrategyWorkspace | `components/strategy/StrategyWorkspace.tsx` | Layout, tabs, apply/cancel draft |
| StrategyCanvas | `components/strategy/StrategyCanvas.tsx` | React Flow graph, autosave, node types |
| AiPromptPanel | `components/strategy/AiPromptPanel.tsx` | AI prompt UI, calls translateStrategy |
| BacktestPanel | `components/strategy/BacktestPanel.tsx` | Run backtest, metrics, chart, data source badge |
| PaperTradingPanel | `components/strategy/PaperTradingPanel.tsx` | Start/stop/reset, poll session+trades, chart; auto-resume via GET paper/session; Replay From date |
| TwoPaneChart | `components/strategy/TwoPaneChart.tsx` | Candlestick/line + equity, markers, streaming |
| MarketDataPage | `app/market-data/page.tsx` | Coverage dashboard: candles, funding rates, OI, liquidations, long/short ratios, jobs |
| nodeTypes | `components/strategy/nodeTypes/` | React Flow node components per graph type |

## Backend / API Modules

| Layer | Path | Responsibility |
|-------|------|----------------|
| Strategies API | `app/api/strategies/route.ts`, `[id]/route.ts` | CRUD strategies; POST requires `name` only; PUT saves graph without validation (backtest/AI validate at run time) |
| Bars API | `app/api/strategies/[id]/bars/route.ts` | Real candles from TimescaleDB; synthetic fallback |
| Backtests API | `app/api/strategies/[id]/backtests/route.ts` | POST creates run; loads real candles via BacktestDataLoader |
| Paper API | `app/api/strategies/[id]/paper/{start,session}`, `app/api/paper/[sessionId]/*` | Session lifecycle + mount resume |
| Market data candles | `app/api/market-data/candles/route.ts` | GET candles from TimescaleDB |
| Market data ingest | `app/api/market-data/ingest/route.ts` | POST triggers ingestion (candle / funding_rate / open_interest) |
| Market data coverage | `app/api/market-data/coverage/route.ts` | GET summary of all stored series |
| Ingestion jobs | `app/api/market-data/jobs/route.ts` | GET recent IngestionJob records |
| Funding rates | `app/api/market-data/funding-rates/route.ts` | GET query + POST ingest |
| Open interest | `app/api/market-data/open-interest/route.ts` | GET query + POST ingest |
| AI translate | `app/api/ai/translateStrategy/route.ts` | Calls `claude-sonnet-4-6`; validates with `validateGraph()`; one self-correction retry; requires `ANTHROPIC_API_KEY` |

## Market Data Layer

```
CCXT (Binance / Bybit / OKX USDT-perp)         Hyperliquid REST
    └── CCXTProvider                               └── NativeHyperliquidProvider
          ├── fetchCandles()                             ├── fetchCandles()
          ├── fetchFundingRates()                        ├── fetchFundingRates()
          └── fetchOpenInterest()                        └── fetchOpenInterest() → []

CoinGlass REST (public v2 API)                  ← standalone, not a MarketDataProvider
    └── CoinGlassProvider  (requires COINGLASS_API_KEY)
          ├── fetchLiquidations(symbol, timeframe) → Liquidation[]
          └── fetchLongShortRatios(symbol, timeframe) → LongShortRatio[]
          TF mapping: { "1h": 0, "4h": 1, "1d": 3 }  (timeType integer)
          Rate limit: ~30 req/min on free tier

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
LiquidationIngestionService  → TimescaleRepository.insertLiquidations()    (ON CONFLICT DO NOTHING)
LongShortRatioIngestionService → TimescaleRepository.insertLongShortRatios() (ON CONFLICT DO NOTHING)

WebSocket live ingestion (ws-ingest.job.ts)
  Binance USDT-M kline stream (native Node.js WebSocket)
  → TimescaleRepository.insertCandles() on each closed candle

                │
                ▼
        TimescaleDB hypertables:
          candles, funding_rates, open_interest,
          liquidations, long_short_ratios

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
- **PaperSession**: status, engineState (JSON), equity, position, `useRealBars` (always true on new sessions), `barCursor` (DateTime? — last replayed candle open_time).
- **PaperTrade**: sessionId, side, qty, entry/exit, pnl.
- **IngestionJob**: exchange, symbol, timeframe, dataType, status, rowsInserted, meta.
- **candles** (TimescaleDB): exchange, symbol, timeframe, open_time → OHLCV.
- **funding_rates** (TimescaleDB): exchange, symbol, funding_time, funding_rate, mark_price.
- **open_interest** (TimescaleDB): exchange, symbol, timeframe, ts, open_interest, open_interest_value.
- **liquidations** (TimescaleDB): ts, symbol, timeframe, source, buy_liq_usd, sell_liq_usd. (CoinGlass global bars)
- **long_short_ratios** (TimescaleDB): ts, symbol, timeframe, source, long_ratio, short_ratio, long_short_ratio. (CoinGlass account ratios)

## Strategy Graph Flow

1. **Save**: StrategyCanvas → PUT `/api/strategies/:id` → Prisma update (no graph validation; supports incremental edits and empty canvas).
2. **Create**: `/strategies` → POST `/api/strategies` with `{ name }` (optional empty `nodes`/`edges`) → redirect to workspace.
3. **Backtest**: BacktestPanel → POST `/api/strategies/:id/backtests` → `validateGraph` → `BacktestDataLoader.load()` → real candles (or SAMPLE_CANDLES fallback) → `runBacktest` → trades persisted.
4. **Paper resume**: PaperTradingPanel mount → GET `/api/strategies/:id/paper/session` → if running, re-attach polling; if stopped, show snapshot + trades.
5. **Paper**: POST `/api/strategies/:id/paper/start` with optional `{ replayFrom }` → PaperSession; GET `/api/paper/:sessionId` fetches up to 5 TimescaleDB candles after `barCursor` per poll.

## Separation of Concerns

| Concern | Location |
|---------|----------|
| UI | `app/strategies/page.tsx`, `components/strategy/*`, `app/market-data/page.tsx` |
| Route handlers | `app/api/*` |
| Engine logic | `lib/strategy/engine/*`, `lib/backtest/backtest.ts` |
| Metrics computation | `lib/backtest/metrics.ts` |
| Funding cost per bar | `lib/backtest/funding.ts` |
| Validation | `lib/strategy/validator.ts` (backtest + AI translate); `compileGraph` at paper poll; save/create routes do not validate |
| Market data fetch | `lib/market-data/providers/ccxt.provider.ts` |
| CoinGlass data fetch | `lib/market-data/providers/coinglass.provider.ts` |
| Data quality | `lib/market-data/ingestion/quality-checker.ts` |
| Candle ingestion | `lib/market-data/ingestion/historical-service.ts` |
| Funding rate ingestion | `lib/market-data/ingestion/funding-rate-service.ts` |
| OI ingestion | `lib/market-data/ingestion/open-interest-service.ts` |
| Liquidation ingestion | `lib/market-data/ingestion/liquidation-service.ts` |
| Long/short ratio ingestion | `lib/market-data/ingestion/long-short-service.ts` |
| TimescaleDB access | `lib/market-data/storage/timescale.repo.ts` |
| Backtest data loading | `lib/backtest/data-loader.ts` |

## Current Weak Points / Technical Debt

1. **Poll-only paper advancement**: Paper trading advances only when a client polls. No background worker — if no tab is open, the session does not advance. Concurrent tabs use optimistic locking with up to 3 server-side retries per poll.
2. **No real-time feed**: Paper replays historical candles from TimescaleDB; it is not driven by a live stream. Phase 4 would add Redis pub/sub for true live advancement.
3. **Ingestion required for paper**: No synthetic fallback; sessions stall if no candles exist for the strategy instrument.
4. **AI quality**: LLM output is non-deterministic; the retry loop handles most validation failures but exotic prompts may still return a 422.
5. **OI availability**: `fetchOpenInterestHistory` is not supported on all CCXT exchanges; service throws and ingestion job records the failure.
