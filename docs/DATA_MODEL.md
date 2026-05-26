# Data Model

## Schema Overview

```
Strategy      → BacktestRun[], PaperSession[]
BacktestRun   → Strategy, Trade[]
Trade         → BacktestRun
PaperSession  → Strategy, PaperTrade[]
PaperTrade    → PaperSession
IngestionJob  (standalone, tracks all data backfill jobs)

TimescaleDB (raw SQL, not Prisma):
  candles          (hypertable, partitioned by open_time, 7-day chunks)
  funding_rates    (hypertable, partitioned by funding_time, 1-day chunks)
  open_interest    (hypertable, partitioned by ts, 7-day chunks)
```

## Prisma Models

### Strategy

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| name | string | |
| description | string? | |
| instrument | string | e.g. "BTC-PERP"; resolved via INSTRUMENT_MAP |
| timeframe | string | e.g. "1h" |
| nodes | Json | React Flow nodes |
| edges | Json | React Flow edges |
| createdAt, updatedAt | DateTime | |

### BacktestRun

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| strategyId | string | FK → Strategy |
| mode | string | "backtest" \| "paper" |
| status | string | queued, running, completed, failed |
| startTime, endTime | DateTime? | Actual data window used |
| metrics | Json? | See Metrics shape below |
| log | Json? | See Log shape below |
| trades | Trade[] | |

**Metrics shape**:
```ts
{
  totalReturnPct: number;
  netPnl: number;
  maxDrawdownPct: number;
  winRate: number;
  numberOfTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}
```

**Log shape**:
```ts
{
  equityCurve: { time: string; equity: number }[];
  debugEvents: DebugEvent[];
  initialCapital: number;
  dataSource: "real" | "sample";
  dataSourceLabel: string;  // e.g. "binance BTC/USDT:USDT 1h (2159 bars, 100.0% coverage)"
  error?: string;           // only on failed runs
}
```

### Trade (Backtest)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| runId | string | FK → BacktestRun |
| side | string | "long" \| "short" |
| entryTime | string | ISO |
| entryPrice | float | |
| exitTime, exitPrice | string?, float? | |
| qty | float | |
| pnl | float | |
| reasonOpen, reasonClose | Json | Signal node IDs |

### PaperSession

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| strategyId | string | FK → Strategy |
| status | string | idle, running, stopped, error |
| instrument, timeframe | string | Copied from strategy |
| lastPrice | float | Last simulated bar close |
| equity, realizedPnl, unrealizedPnl | float | |
| positionSide, positionQty, positionEntryPrice | string?, float, float? | |
| positionOpenedAt | DateTime? | |
| engineState | Json? | Serialized EngineState |
| useRealBars | Boolean | Default false; replay real TimescaleDB candles instead of synthetic |
| barCursor | DateTime? | Last replayed candle's open_time; null = start from earliest |
| startedAt, updatedAt, createdAt | DateTime | |

### PaperTrade

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| sessionId | string | FK → PaperSession |
| side | string | long \| short |
| qty | float | |
| entryTime, exitTime | DateTime, DateTime? | |
| entryPrice, exitPrice | float, float? | |
| pnl | float | |

### IngestionJob

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| exchange | string | e.g. "binance" |
| symbol | string | CCXT unified, e.g. "BTC/USDT:USDT" |
| timeframe | string | e.g. "1h" |
| dataType | string | "candle" \| "funding_rate" \| "open_interest" |
| startTime, endTime | DateTime | Requested window |
| status | string | pending, running, completed, failed |
| rowsInserted | int? | Rows upserted |
| error | string? | Error message on failure |
| startedAt | DateTime? | |
| completedAt | DateTime? | |
| createdAt | DateTime | |
| meta | Json? | `{ gapsFilled: number, durationMs: number }` |

Indexes: `[status]`, `[exchange, symbol, dataType, startTime]`

## TimescaleDB Tables

All managed via `db/migrations/timescale/*.sql` (not Prisma). Run `npm run setup:timescale` to apply.

### candles

| Column | Type | Notes |
|--------|------|-------|
| open_time | TIMESTAMPTZ | Partition key (7-day chunks) |
| exchange | TEXT | e.g. "binance" |
| symbol | TEXT | CCXT unified e.g. "BTC/USDT:USDT" |
| timeframe | TEXT | e.g. "1h" |
| open, high, low, close | DOUBLE PRECISION | Native JS numbers |
| volume | DOUBLE PRECISION | Base asset volume |
| quote_volume | DOUBLE PRECISION | |
| trade_count | INTEGER | |

**Primary key / unique index**: `(open_time, exchange, symbol, timeframe)` → `ON CONFLICT DO NOTHING`  
**Compression**: after 30 days, segmented by `(exchange, symbol, timeframe)`

### funding_rates

| Column | Type | Notes |
|--------|------|-------|
| funding_time | TIMESTAMPTZ | Partition key (1-day chunks) |
| exchange | TEXT | |
| symbol | TEXT | |
| funding_rate | DOUBLE PRECISION | Decimal e.g. 0.0001 = 0.01% |
| mark_price | DOUBLE PRECISION | Nullable |

**Compression**: after 7 days, segmented by `(exchange, symbol)`

### open_interest

| Column | Type | Notes |
|--------|------|-------|
| ts | TIMESTAMPTZ | Partition key (7-day chunks) |
| exchange | TEXT | |
| symbol | TEXT | |
| timeframe | TEXT | Snapshot granularity |
| open_interest | DOUBLE PRECISION | Base asset quantity |
| open_interest_value | DOUBLE PRECISION | Quote value (nullable) |

**Compression**: after 30 days, segmented by `(exchange, symbol, timeframe)`

## Instrument Resolution

`lib/market-data/types.ts` — `INSTRUMENT_MAP`:

```ts
// Binance (default)
"BTC-PERP"        → { exchange: "binance", symbol: "BTC/USDT:USDT" }
"ETH-PERP"        → { exchange: "binance", symbol: "ETH/USDT:USDT" }
"SOL-PERP"        → { exchange: "binance", symbol: "SOL/USDT:USDT" }
"BNB-PERP"        → { exchange: "binance", symbol: "BNB/USDT:USDT" }
"XRP-PERP"        → { exchange: "binance", symbol: "XRP/USDT:USDT" }
"DOGE-PERP"       → { exchange: "binance", symbol: "DOGE/USDT:USDT" }

// Bybit
"BTC-PERP-BYBIT"  → { exchange: "bybit", symbol: "BTC/USDT:USDT" }
"ETH-PERP-BYBIT"  → { exchange: "bybit", symbol: "ETH/USDT:USDT" }
"SOL-PERP-BYBIT"  → { exchange: "bybit", symbol: "SOL/USDT:USDT" }

// OKX
"BTC-PERP-OKX"    → { exchange: "okx", symbol: "BTC/USDT:USDT" }
"ETH-PERP-OKX"    → { exchange: "okx", symbol: "ETH/USDT:USDT" }

// Hyperliquid
"BTC-PERP-HL"     → { exchange: "hyperliquid", symbol: "BTC/USDT:USDT" }
"ETH-PERP-HL"     → { exchange: "hyperliquid", symbol: "ETH/USDT:USDT" }
"SOL-PERP-HL"     → { exchange: "hyperliquid", symbol: "SOL/USDT:USDT" }
```

## Strategy Graph Schema

Stored as `nodes` and `edges` JSON. Zod schemas in `lib/strategy/graphTypes.ts`:

- **Nodes**: `{ id, type, position, data }`; type one of: price, volume, rsi, constant, compare, cross, and, or, not, open_position, close_position, set_risk
- **Edges**: `{ id, source, target, sourceHandle?, targetHandle? }`
- Validation: DAG, required open_position + (close_position or set_risk), no cycles

## Persisted vs Ephemeral

| Entity | Persisted | Ephemeral |
|--------|-----------|-----------|
| Strategy | ✅ DB (Prisma) | — |
| BacktestRun | ✅ DB (Prisma) | — |
| Trade (backtest) | ✅ DB (Prisma) | — |
| PaperSession | ✅ DB (Prisma) | — |
| PaperTrade | ✅ DB (Prisma) | — |
| IngestionJob | ✅ DB (Prisma) | — |
| candles | ✅ TimescaleDB | — |
| funding_rates | ✅ TimescaleDB | — |
| open_interest | ✅ TimescaleDB | — |
| EngineState | ✅ DB (PaperSession.engineState) | In-memory during step |
| Draft graph | — | React state |
| Poll state | — | React component state |
| Chart buffers | — | Lightweight Charts series data |
