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
| GET | `/api/strategies/[id]/paper/session` | Latest running/stopped session for strategy (404 if none) |
| POST | `/api/strategies/[id]/paper/start` | Create paper session or return existing running session |
| GET | `/api/backtests/[runId]` | Get backtest run |
| GET | `/api/backtests/[runId]/trades` | Get run trades |
| GET | `/api/backtests/[runId]/export` | Download backtest as CSV (METRICS + TRADES + EQUITY_CURVE) |
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
| POST | `/api/ai/translateStrategy` | Calls `claude-sonnet-4-6`; validates graph; one retry on failure. Requires `ANTHROPIC_API_KEY`. |

## API Shapes

### POST `/api/strategies`

**Request**: `{ name, description?, timeframe?, nodes?, edges? }` — only `name` is required  
**Response**: Strategy object (201). Defaults: `instrument=BTC-PERP`, `timeframe=1h`.  
**Notes**: No `validateGraph` on create — blank canvas (`nodes`/`edges` omitted or `[]`) is valid. Graph validation runs when starting a backtest or applying AI output.

### PUT `/api/strategies/[id]`

**Request**: `{ name?, description?, timeframe?, nodes?, edges? }`  
**Response**: Strategy object  
**Notes**: Saves incremental canvas edits without graph validation. Invalid graphs are rejected at backtest start (`400` with validation errors).

### POST `/api/strategies/[id]/backtests`

**Request**: `{ initialCapital?, feeBps?, startTime?, endTime? }` (all optional; defaults: `initialCapital=10000`, `feeBps=5`, `startTime=now−90d`, `endTime=now`)  
**Response**: BacktestRun (201), `log.dataSource` and `log.dataSourceLabel` included

### GET `/api/backtests/[runId]/export`

**Query params**: none  
**Response**: CSV file attachment — `Content-Disposition: attachment; filename="backtest-<runId[:8]>.csv"`

The CSV has a comment header block followed by three labeled sections:

```
# QuantBlocks Backtest Export
# Run ID: <runId>
# Period start: <startTime>
# Period end: <endTime>
# Data source: <dataSourceLabel>

# METRICS
Metric,Value
Total Return %,...
Net PnL,...
Max Drawdown %,...
Win Rate,...
...

# TRADES
Side,Entry Time,Entry Price,Exit Time,Exit Price,Qty,PnL,Reason Open,Reason Close
...

# EQUITY_CURVE
Time,Equity
...
```

**404** — run not found  
**400** — run found but status is not `completed`

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
5. **Funding rate load** (best-effort, real-data path only): `repo.queryFundingRates(exchange, symbol, from, to)` — loaded and passed as `fundingRates` into `runBacktest`; silently skipped if DB unavailable; `fundingRatesLoaded` count stored in `run.log`
6. `runBacktest(graph, candles, config)` — synchronous; per-bar `barFundingCost` deducted from equity; cumulative funding cost forwarded to `computeMetrics`
7. `computeMetrics` (in `lib/backtest/metrics.ts`) produces: totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, avgWin, avgLoss, profitFactor, sharpe, sortino, calmar, benchmarkReturnPct, fundingCostPaid
8. Persist trades, update run (status, metrics, log including dataSource/dataSourceLabel, fundingRatesLoaded)

## Paper Trading Flow

### Resume (mount)

GET `/api/strategies/:id/paper/session`  
**Response**: SessionSnapshot (200) — most recent session with `status` in `running` | `stopped`, ordered by `updatedAt` desc  
**404**: No such session (never started, or reset to idle)

### Start

POST `/api/strategies/:id/paper/start`  
**Body** (all optional): `{ replayFrom?: ISO date string, replaySpeed?: number }`

Creates PaperSession with `useRealBars=true` (always) and `barCursor` (= `replayFrom` date, or null). Also seeds `lastPrice` from the most recent TimescaleDB candle (falls back to 100 if unavailable).

If `replaySpeed` is provided, the session is created in worker mode and the background paper worker will advance it at up to 600 bars/sec until it reaches the live edge. If omitted, the session advances only via client polling.

Returns existing running session unchanged. **409** if a session is already running and the body includes a different `replayFrom` (stop first).

When `barCursor` is null, the poll route defaults to `session.startedAt − 90 days` as the query start, matching the default ingestion window.

### Poll

GET `/api/paper/:sessionId`:
1. Resolves `session.instrument` → exchange + CCXT symbol via `INSTRUMENT_MAP`; returns current snapshot if unresolvable or invalid timeframe
2. Queries TimescaleDB: `queryCandles({ startTime: barCursor + 1ms, limit: 5 })`
3. Steps engine through returned candles; persists trades (cross-poll closes update open row by ID)
4. **Optimistic lock**: `updateMany({ id, updatedAt })` — on collision, re-fetch session and retry up to 3 times (replay from winner's `barCursor`); if all retries fail, return latest DB snapshot (client retries on next 1s poll)
5. If no candles available (caught up, no data ingested, or DB unavailable), returns current snapshot unchanged

### Stop / Reset

- **Stop**: POST `/api/paper/:sessionId/stop` → force-close, status=stopped
- **Reset**: POST `/api/paper/:sessionId/reset` → delete trades, clear engineState + barCursor, status=idle; re-seeds `lastPrice` from latest TimescaleDB candle (falls back to 100)

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

- Paper trading replays TimescaleDB history only (not a live stream); stalls if no candles ingested for the instrument.
- Paper execution only on poll; no real-time advancement.
- `fetchOpenInterestHistory` not available on all CCXT exchanges — service throws, job is marked failed.
- No rate limiting or auth on API routes.
- Backtest runs synchronously — large datasets could hit serverless timeouts.
