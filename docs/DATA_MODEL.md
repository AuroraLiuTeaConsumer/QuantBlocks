# Data Model

## Prisma Schema Summary

```prisma
Strategy      → BacktestRun[], PaperSession[]
BacktestRun   → Strategy, Trade[]
Trade         → BacktestRun
PaperSession  → Strategy, PaperTrade[]
PaperTrade    → PaperSession
```

## Important Models and Relationships

### Strategy

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| name | string | |
| description | string? | |
| instrument | string | default "BTC-PERP" |
| timeframe | string | default "1h" |
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
| startTime, endTime | string? | ISO strings |
| metrics | Json? | totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, etc. |
| log | Json? | equityCurve, debugEvents, initialCapital, error |
| trades | Trade[] | |

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
| reasonOpen, reasonClose | Json | |

### PaperSession

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| strategyId | string | FK → Strategy |
| status | string | idle, running, stopped, error |
| instrument, timeframe | string | |
| lastPrice | float | |
| equity, realizedPnl, unrealizedPnl | float | |
| positionSide, positionQty, positionEntryPrice | string?, float, float? | |
| positionOpenedAt | DateTime? | |
| engineState | Json? | Serialized EngineState |
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

## Strategy Graph Schema

Stored as `nodes` and `edges` JSON. Zod schemas in `lib/strategy/graphTypes.ts`:

- **Nodes**: `{ id, type, position, data }`; type one of price, volume, rsi, constant, compare, cross, and, or, not, open_position, close_position, set_risk
- **Edges**: `{ id, source, target, sourceHandle?, targetHandle? }`
- Validation: DAG, required open_position + (close_position or set_risk), no cycles

## Run / Session / Trade Entities

| Entity | Persisted | Ephemeral |
|--------|-----------|-----------|
| Strategy | ✅ DB | — |
| BacktestRun | ✅ DB | — |
| Trade (backtest) | ✅ DB | — |
| PaperSession | ✅ DB | — |
| PaperTrade | ✅ DB | — |
| EngineState | ✅ DB (PaperSession.engineState) | In-memory during step |
| Draft graph | — | React state (AiPromptPanel → Workspace) |

## Persisted vs Ephemeral

- **Persisted**: Strategy, BacktestRun, Trade, PaperSession, PaperTrade, engineState in session
- **Ephemeral**: Draft graph, poll state, chart streaming buffers, UI-only state
