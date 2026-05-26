# Backend

## Route Inventory

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create strategy |
| GET | `/api/strategies/[id]` | Get strategy |
| PUT | `/api/strategies/[id]` | Update strategy |
| DELETE | `/api/strategies/[id]` | Delete strategy |
| GET | `/api/strategies/[id]/bars` | Real OHLC bars (TimescaleDB → synthetic fallback) |
| POST | `/api/strategies/[id]/backtests` | Start backtest (synchronous) |
| POST | `/api/strategies/[id]/paper/start` | Create/resume paper session |
| GET | `/api/backtests/[runId]` | Get backtest run |
| GET | `/api/backtests/[runId]/trades` | Get run trades |
| GET | `/api/paper/[sessionId]` | Poll session; advances engine if running |
| POST | `/api/paper/[sessionId]/stop` | Stop session |
| POST | `/api/paper/[sessionId]/reset` | Reset session to idle |
| GET | `/api/paper/[sessionId]/trades` | Get paper trades |
| GET | `/api/market-data/candles` | Query candles from TimescaleDB |
| POST | `/api/market-data/ingest` | Trigger ad-hoc CCXT ingestion |
| POST | `/api/ai/translateStrategy` | **Stub** — returns RSI graph |

## API Shapes

### POST `/api/strategies`

**Request**: `{ name, description?, timeframe?, nodes, edges }`  
**Response**: Strategy object (201)

### PUT `/api/strategies/[id]`

**Request**: `{ name?, description?, timeframe?, nodes?, edges? }`  
**Response**: Strategy object

### GET `/api/strategies/[id]/bars`

**Query**: `timeframe?`, `limit?`  
**Response**: `BarItem[]` — `{ time, open, high, low, close, volume? }` (UTC seconds)  
**Header**: `X-Data-Source: real:<exchange>:<symbol>` or `synthetic`

### POST `/api/strategies/[id]/backtests`

**Request**: `{ initialCapital?, feeBps?, startTime?, endTime? }` (all optional)  
**Response**: BacktestRun (201), including `log.dataSource` and `log.dataSourceLabel`

### POST `/api/strategies/[id]/paper/start`

**Request**: none  
**Response**: SessionSnapshot

### GET `/api/paper/[sessionId]`

**Response**: SessionSnapshot (advances session if status=running)

### GET `/api/market-data/candles`

**Query**: `instrument=BTC-PERP` or `exchange=binance&symbol=BTC/USDT:USDT`, `timeframe`, `from` (ISO), `to` (ISO), `limit`  
**Response**: `Candle[]`

### POST `/api/market-data/ingest`

**Request**: `{ instrument?, exchange?, symbol?, timeframe?, days? }`  
**Response**: `{ jobId, rowsInserted, gapsFilled, durationMs }`

### POST `/api/ai/translateStrategy`

**Request**: `{ prompt, timeframe? }`  
**Response**: `{ strategyName, timeframe, nodes, edges, notes }`

## Prisma Models Involved

- `Strategy`: nodes, edges, instrument, timeframe
- `BacktestRun`: strategyId, status, metrics, log (includes dataSource/dataSourceLabel)
- `Trade`: runId, side, entry/exit, qty, pnl, reasonOpen/Close
- `PaperSession`: strategyId, status, engineState, equity, position fields
- `PaperTrade`: sessionId, side, qty, entry/exit, pnl
- `IngestionJob`: exchange, symbol, timeframe, status, rowsInserted, meta

## In-Memory / Singletons

- `lib/prisma.ts`: Global PrismaClient singleton (dev hot-reload safe)
- `lib/market-data/storage/timescale.client.ts`: Global `pg.Pool` singleton via `global.__timescalePool`
- `lib/market-data/storage/timescale.repo.ts`: `getTimescaleRepo()` singleton
- `lib/backtest/data-loader.ts`: `getBacktestDataLoader()` singleton

## Backtest Flow

1. POST `/api/strategies/:id/backtests` → load strategy → validate graph → create BacktestRun (status=running)
2. `resolveInstrument(strategy.instrument)` → exchange + CCXT symbol
3. `BacktestDataLoader.load({ exchange, symbol, timeframe, startTime, endTime })` — queries TimescaleDB, checks ≥80% coverage
4. On success: use real candles. On `InsufficientDataError` or DB error: fall back to `SAMPLE_CANDLES`, log warning
5. `runBacktest(graph, candles, config)` — synchronous, shared engine
6. Persist trades to `Trade`
7. Update run: status=completed, metrics, log (equityCurve, debugEvents, dataSource, dataSourceLabel)
8. Return run

## Paper Trading Flow

1. **Start**: POST `/api/strategies/:id/paper/start` → create PaperSession (status=running), `engineState` from `createInitialState`
2. **Poll**: GET `/api/paper/:sessionId` → if running: compute bars from elapsed time, `step` engine for each bar, persist trades, update session (optimistic lock)
3. **Stop**: POST `/api/paper/:sessionId/stop` → force-close position, set status=stopped
4. **Reset**: POST `/api/paper/:sessionId/reset` → delete trades, reset session to idle

## Instrument Resolution

Strategies store an internal instrument name (e.g. `BTC-PERP`). The route layer calls `resolveInstrument()` from `lib/market-data/types.ts` to map to `{ exchange, symbol }` (e.g. `{ exchange: "binance", symbol: "BTC/USDT:USDT" }`). If the instrument is unknown, the route falls back to sample data gracefully.

## Known Backend Risks

- Paper bars are still synthetic; no real-time feed.
- Paper execution only on poll; no real-time advancement.
- Optimistic lock on paper session can fail under concurrent polls; no retry logic.
- No rate limiting or auth on API routes.
- Backtest runs synchronously in the API route — large datasets could hit serverless timeouts.
