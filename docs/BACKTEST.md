# Backtest

## Current Architecture

- **Entry**: POST `/api/strategies/:id/backtests`
- **Engine**: `lib/backtest/backtest.ts` — uses `lib/strategy/compiler.ts` (compilePlan, evaluateBar)
- **Data**: `lib/data/candles.ts` → `SAMPLE_CANDLES` (60 synthetic 1h bars, fixed pattern for RSI demo)
- **Execution**: Synchronous; run completes before API response

## How Runs Are Created and Polled

1. Client POSTs to backtests route with optional `{ initialCapital, feeBps }`
2. Server creates BacktestRun (status=running), runs `runBacktest` synchronously
3. Trades persisted to Trade; run updated to completed with metrics and log
4. Response returns run; client may poll GET `/api/backtests/:runId` if expecting async (current impl is sync, so polling usually sees completed immediately)

## How Trades and Equity Are Produced

- **Compiler**: `compilePlan(graph)` → `CompiledPlan`; `evaluateBar(plan, state, candles, barIndex)` → `BarAction[]`
- **Backtest loop**: For each candle: fill pending orders at bar open, check SL/TP, evaluate bar, queue open/close for next bar
- **Equity**: Snapshot at each bar close; unrealized PnL from position
- **Metrics**: totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, avgWin, avgLoss

## Current Limitation: Synthetic Bars / Stub Data

- `SAMPLE_CANDLES` is 60 bars from 2025-01-01, designed for RSI(14) demo (buy RSI<30, sell RSI>70)
- No configurable date range or instrument
- Bars route (`/api/strategies/:id/bars`) returns random-walk data; backtest does **not** use it — backtest uses SAMPLE_CANDLES only
- Chart fetches bars from bars route for overlay; these are different from backtest candles (time alignment may be wrong)

## What Must Change for Real Historical Exchange Data

1. **Data source**: Exchange API (e.g. Hyperliquid) for OHLC
2. **Storage**: Optional cache/DB for historical bars
3. **Date range**: Backtest POST accepts start/end; fetch or load bars for that range
4. **Unify**: Backtest should use same bars as chart (or at least same source)
5. **Timeframe**: Strategy timeframe must match bar resolution

## Recommended Next Steps for Quant-Grade Backtesting

1. **Configurable candles**: Accept `startTime`, `endTime`, `limit` in backtest POST; fetch from exchange or DB
2. **Single engine**: Migrate backtest to `lib/strategy/engine` for consistency with paper
3. **Walk-forward**: Support multiple windows for robustness testing
4. **Metrics**: Add Sharpe, Sortino, Calmar; optionally benchmark vs buy-and-hold
5. **Slippage**: Currently 0; add configurable slippage model
6. **Async runs**: For large datasets, queue run and poll (worker process or serverless)
