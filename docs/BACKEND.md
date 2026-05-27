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
| GET | `/api/market-data/candles` | Query OHLCV candles from TimescaleDB |
| POST | `/api/market-data/ingest` | Trigger ingestion (candle / funding_rate / open_interest) |
| GET | `/api/market-data/coverage` | Summary of all stored series (candles, FR, OI) |
| GET | `/api/market-data/jobs` | Recent IngestionJob records |
| GET | `/api/market-data/funding-rates` | Query funding rate events |
| POST | `/api/market-data/funding-rates` | Trigger funding rate ingestion |
| GET | `/api/market-data/open-interest` | Query open interest snapshots |
| POST | `/api/market-data/open-interest` | Trigger open interest ingestion |
| GET | `/api/market-data/liquidations` | Query stored CoinGlass liquidation bars |
| POST | `/api/market-data/liquidations` | Trigger liquidation ingestion (503 if no key) |
| GET | `/api/market-data/long-short-ratios` | Query stored CoinGlass L/S account ratios |
| POST | `/api/market-data/long-short-ratios` | Trigger long/short ratio ingestion (503 if no key) |
| POST | `/api/ai/translateStrategy` | **Stub** — returns RSI graph |

## API Shapes

### POST `/api/strategies/[id]/backtests`

**Request**: `{ initialCapital?, feeBps?, startTime?, endTime? }` (all optional)  
**Response**: BacktestRun (201), `log.dataSource` and `log.dataSourceLabel` included

### GET `/api/strategies/[id]/bars`

**Query**: `timeframe?`, `limit?`  
**Response**: `BarItem[]` — `{ time, open, high, low, close, volume? }` (UTC seconds)  
**Header**: `X-Data-Source: real:<exchange>:<symbol>` or `synthetic`

### POST `/api/market-data/ingest`

**Request**:
```json
{
  "instrument": "BTC-PERP",
  "dataType": "candle",
  "days": 90
}
```
`dataType` values: `candle` (default) | `funding_rate` | `open_interest` | `liquidation` | `long_short`  
**Response**: `{ jobId, rowsInserted, gapsFilled, durationMs }`  
**400** if `dataType` is `liquidation` or `long_short` and `timeframe` is not one of `1h | 4h | 1d` (CoinGlass only supports these three).  
**503** if `dataType` is `liquidation` or `long_short` and `COINGLASS_API_KEY` is not set.

Both the 400 and 503 are returned **before** an `IngestionJob` record is created, so the job table never contains a record with an unsupported timeframe.

### GET `/api/market-data/coverage`

**Response**:
```json
{
  "candles": [{ "exchange", "symbol", "timeframe", "barCount", "oldestBar", "newestBar" }],
  "fundingRates": [{ "exchange", "symbol", "count", "oldest", "newest" }],
  "openInterest": [{ "exchange", "symbol", "timeframe", "count", "oldest", "newest" }],
  "generatedAt": "ISO"
}
```

### GET `/api/market-data/funding-rates`

**Query**: `instrument?` or `exchange?` + `symbol?`, `from?`, `to?`, `limit?` (max 5000)  
**Response**: `FundingRate[]`

### GET `/api/market-data/open-interest`

**Query**: same as funding-rates, plus `timeframe?` (default `1h`)  
**Response**: `OpenInterest[]`

### GET `/api/market-data/liquidations`

**Query**: `symbol?`, `timeframe?` (one of `1h` | `4h` | `1d`), `from?`, `to?`, `limit?`  
**Response**: `Liquidation[]` — `{ ts, symbol, timeframe, source, buy_liq_usd, sell_liq_usd }`

### POST `/api/market-data/liquidations`

Triggers `LiquidationIngestionService.ingest(spec)` for the given symbol + timeframe.  
**Request**: `{ symbol: string, timeframe: "1h" | "4h" | "1d" }`  
**Response**: `{ rowsInserted }` on success  
**503** if `COINGLASS_API_KEY` is not set.

### GET `/api/market-data/long-short-ratios`

**Query**: `symbol?`, `timeframe?` (one of `1h` | `4h` | `1d`), `from?`, `to?`, `limit?`  
**Response**: `LongShortRatio[]` — `{ ts, symbol, timeframe, source, long_ratio, short_ratio, long_short_ratio }`

### POST `/api/market-data/long-short-ratios`

Triggers `LongShortRatioIngestionService.ingest(spec)` for the given symbol + timeframe.  
**Request**: `{ symbol: string, timeframe: "1h" | "4h" | "1d" }`  
**Response**: `{ rowsInserted }` on success  
**503** if `COINGLASS_API_KEY` is not set.

## Prisma Models Involved

- `Strategy`: nodes, edges, instrument, timeframe
- `BacktestRun`: strategyId, status, metrics, log (dataSource/dataSourceLabel/quality)
- `Trade`: runId, side, entry/exit, qty, pnl
- `PaperSession`: strategyId, status, engineState, equity, position fields
- `PaperTrade`: sessionId, side, qty, entry/exit, pnl
- `IngestionJob`: exchange, symbol, timeframe, dataType, status, rowsInserted, meta

## In-Memory / Singletons

- `lib/prisma.ts`: Global PrismaClient singleton (dev hot-reload safe)
- `lib/market-data/storage/timescale.client.ts`: Global `pg.Pool` singleton via `global.__timescalePool`
- `lib/market-data/storage/timescale.repo.ts`: `getTimescaleRepo()` singleton
- `lib/backtest/data-loader.ts`: `getBacktestDataLoader()` singleton

## Backtest Flow

1. POST `/api/strategies/:id/backtests` → load strategy → validate graph → create BacktestRun
2. `resolveInstrument(strategy.instrument)` → exchange + CCXT symbol
3. `BacktestDataLoader.load(...)` — queries TimescaleDB, checks ≥80% coverage
4. On success: real candles. On `InsufficientDataError` or DB error: `SAMPLE_CANDLES`, log warning
5. `runBacktest(graph, candles, config)` — synchronous, shared engine
6. Persist trades, update run (status, metrics, log including dataSource/dataSourceLabel)

## Paper Trading Flow

### Start

POST `/api/strategies/:id/paper/start`  
**Body** (all optional): `{ useRealBars?: boolean, replayFrom?: ISO date string }`

Creates PaperSession with `useRealBars` and `barCursor` (= `replayFrom` or null).

### Poll (synthetic mode — default)

GET `/api/paper/:sessionId` → computes elapsed time → generates up to 10 synthetic random-walk bars → steps engine → persists trades (optimistic lock)

### Poll (real-bar mode)

GET `/api/paper/:sessionId` (when `useRealBars=true`):
1. Resolves `session.instrument` → exchange + CCXT symbol via `INSTRUMENT_MAP`
2. Queries TimescaleDB: `queryCandles({ startTime: barCursor + 1ms, limit: 5 })`
3. Feeds real candles to engine; updates `barCursor` to last candle's `open_time`
4. If no candles available (caught up or DB unavailable), returns current snapshot unchanged

### Stop / Reset

- **Stop**: POST `/api/paper/:sessionId/stop` → force-close, status=stopped
- **Reset**: POST `/api/paper/:sessionId/reset` → delete trades, clear engineState + barCursor, status=idle

## Ingestion Flow (all data types)

All ingestion services share the same pattern:
1. POST `/api/market-data/ingest` (or CLI `npm run ingest -- --dataType <type>`)
2. Create `IngestionJob` (status=running)
3. Dispatch to the relevant service:
   - `candle` → `HistoricalDataIngestionService` (CCXT, gap detection, rate limiting)
   - `funding_rate` → `FundingRateIngestionService` (CCXT)
   - `open_interest` → `OpenInterestIngestionService` (CCXT)
   - `liquidation` → `LiquidationIngestionService` (CoinGlass; 400 if timeframe ∉ {1h,4h,1d}; 503 if no API key)
   - `long_short` → `LongShortRatioIngestionService` (CoinGlass; 400 if timeframe ∉ {1h,4h,1d}; 503 if no API key)
4. Service fetches full history and inserts with `ON CONFLICT DO NOTHING`
5. Update `IngestionJob` (status=completed, rowsInserted, meta)

For candles only: `QualityChecker` runs on each page before insert, accumulates `QualityReport`.

CoinGlass services fetch the full available history in a single call (no cursor paging) and filter to `[startTime, endTime)` before insert.

## Instrument Resolution

`resolveInstrument()` from `lib/market-data/types.ts` maps QuantBlocks instrument IDs to `{ exchange, symbol }`:

```
"BTC-PERP"        → binance, BTC/USDT:USDT
"BTC-PERP-BYBIT"  → bybit,   BTC/USDT:USDT
"BTC-PERP-OKX"    → okx,     BTC/USDT:USDT
```

Used in backtest route, bars route, and market-data routes.

## Known Backend Risks

- Paper bars are still synthetic; no real-time feed.
- Paper execution only on poll; no real-time advancement.
- `fetchOpenInterestHistory` not available on all CCXT exchanges — service throws, job is marked failed.
- No rate limiting or auth on API routes.
- Backtest runs synchronously — large datasets could hit serverless timeouts.
