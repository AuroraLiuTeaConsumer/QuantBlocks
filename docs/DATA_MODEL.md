# Data Model

## Schema Overview

```
Strategy      → BacktestRun[], PaperSession[]
BacktestRun   → Strategy, Trade[]
Trade         → BacktestRun
PaperSession  → Strategy, PaperTrade[]
PaperTrade    → PaperSession
IngestionJob  (standalone, tracks CCXT backfill jobs)

TimescaleDB:
  candles     (hypertable, partitioned by open_time)
```

## Prisma Models

### Strategy

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| name | string | |
| description | string? | |
| instrument | string | e.g. "BTC-PERP"; resolved to exchange+symbol via INSTRUMENT_MAP |
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
                            // or "Sample (synthetic 60-bar dataset)"
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
| reasonOpen, reasonClose | Json | Signal node IDs / reasons |

### PaperSession

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| strategyId | string | FK → Strategy |
| status | string | idle, running, stopped, error |
| instrument, timeframe | string | Copied from strategy at session start |
| lastPrice | float | Last simulated bar close |
| equity, realizedPnl, unrealizedPnl | float | |
| positionSide, positionQty, positionEntryPrice | string?, float, float? | Current open position |
| positionOpenedAt | DateTime? | |
| engineState | Json? | Serialized EngineState (indicators, nodeValues, position) |
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
| dataType | string | "candle" |
| startTime, endTime | DateTime | Requested window |
| status | string | running, completed, failed |
| rowsInserted | int? | Rows upserted into candles table |
| error | string? | Error message on failure |
| startedAt | DateTime? | |
| completedAt | DateTime? | |
| createdAt | DateTime | |
| meta | Json? | `{ gapsFilled: number, durationMs: number }` |

Indexes: `[status]`, `[exchange, symbol, dataType, startTime]`

## TimescaleDB: candles Hypertable

Managed outside Prisma via `db/migrations/timescale/001_candles.sql`.

| Column | Type | Notes |
|--------|------|-------|
| exchange | TEXT | e.g. "binance" |
| symbol | TEXT | CCXT unified e.g. "BTC/USDT:USDT" |
| timeframe | TEXT | e.g. "1h" |
| open_time | TIMESTAMPTZ | Partition key (7-day chunks) |
| close_time | TIMESTAMPTZ | |
| open, high, low, close | DOUBLE PRECISION | Native JS numbers, no string parsing |
| volume | DOUBLE PRECISION | Base asset volume |
| quote_volume | DOUBLE PRECISION | |
| trade_count | BIGINT | |
| closed | BOOLEAN | false = in-progress bar |

**Unique index**: `(exchange, symbol, timeframe, open_time DESC)` — enables `ON CONFLICT DO NOTHING` for idempotent inserts.

**Compression**: After 30 days, segmented by `(exchange, symbol, timeframe)`, ordered by `open_time DESC`.

## Strategy Graph Schema

Stored as `nodes` and `edges` JSON. Zod schemas in `lib/strategy/graphTypes.ts`:

- **Nodes**: `{ id, type, position, data }`; type one of: price, volume, rsi, constant, compare, cross, and, or, not, open_position, close_position, set_risk
- **Edges**: `{ id, source, target, sourceHandle?, targetHandle? }`
- Validation: DAG, required open_position + (close_position or set_risk), no cycles

## Instrument Resolution

`lib/market-data/types.ts` — `INSTRUMENT_MAP`:

```ts
"BTC-PERP" → { exchange: "binance", symbol: "BTC/USDT:USDT" }
"ETH-PERP" → { exchange: "binance", symbol: "ETH/USDT:USDT" }
"SOL-PERP" → { exchange: "binance", symbol: "SOL/USDT:USDT" }
"BNB-PERP" → { exchange: "binance", symbol: "BNB/USDT:USDT" }
```

Used in backtest route and bars route to bridge between the UI instrument name and the CCXT/TimescaleDB symbol.

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
| EngineState | ✅ DB (PaperSession.engineState) | In-memory during step |
| Draft graph | — | React state (AiPromptPanel → Workspace) |
| Poll state | — | React component state |
| Chart buffers | — | Lightweight Charts series data |
