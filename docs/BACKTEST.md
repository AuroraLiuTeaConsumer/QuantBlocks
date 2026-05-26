# Backtest

## Current Architecture

- **Entry**: POST `/api/strategies/:id/backtests`
- **Engine**: `lib/backtest/backtest.ts` wraps `lib/strategy/engine` (compile, step, forceClose)
- **Data**: `lib/backtest/data-loader.ts` → `BacktestDataLoader` → queries TimescaleDB; falls back to `SAMPLE_CANDLES` (60 synthetic bars) when real data is unavailable
- **Execution**: Synchronous; run completes before API response

## Data Source Priority

```
POST /api/strategies/:id/backtests
    │
    ├─ resolveInstrument(strategy.instrument)   → { exchange, symbol }
    │
    ├─ BacktestDataLoader.load({ exchange, symbol, timeframe, startTime, endTime })
    │       └─ TimescaleRepository.queryCandles()
    │               └─ coverage ≥ 80% → return real candles
    │               └─ coverage < 80% → throw InsufficientDataError
    │
    ├─ [success] → use real candles, dataSource = "real"
    │              dataSourceLabel = "binance BTC/USDT:USDT 1h (2159 bars, 100.0% coverage)"
    │
    └─ [InsufficientDataError | any DB error] → SAMPLE_CANDLES, dataSource = "sample"
                                                 log warning to console
```

The `dataSource` and `dataSourceLabel` fields are stored in `BacktestRun.log` and displayed in BacktestPanel as a badge ("● Live" in accent color, or "⚠ Sample" in amber).

## How Runs Are Created and Polled

1. Client POSTs to backtests route with optional `{ initialCapital, feeBps, startTime, endTime }`
2. Server resolves candle data (real or sample, as above)
3. Creates BacktestRun (status=running), runs `runBacktest` synchronously
4. Trades persisted to Trade; run updated to completed with metrics and log
5. Response returns the completed run immediately (synchronous)

## How Trades and Equity Are Produced

- **Engine compile**: `compileGraph(graph)` → `CompiledGraph`; `step(state, bar)` → `{ signals, newState }`
- **Backtest loop** (`lib/backtest/backtest.ts`):
  - Fill pending orders at bar open (with fee + slippage)
  - Check stop-loss / take-profit
  - Step engine to get signals for current bar
  - Queue open/close for next bar
- **Equity**: Snapshot at each bar close including unrealized PnL
- **Metrics**: totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, avgWin, avgLoss, profitFactor

## BacktestDataLoader

`src/lib/backtest/data-loader.ts`

```ts
interface DataLoaderQuery {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
}

interface DataLoaderResult {
  candles: BacktestInputCandle[];  // { time: string (ISO), open, high, low, close, volume }
  candleCount: number;
  coveragePct: number;             // actual / expected bars × 100
}
```

- Coverage threshold: **80%** — below this, `InsufficientDataError` is thrown
- `InsufficientDataError` message includes the `npm run ingest` hint so it surfaces in logs

## Instrument Resolution

The backtest route calls `resolveInstrument(strategy.instrument)` from `lib/market-data/types.ts`:

```ts
// BTC-PERP → { exchange: "binance", symbol: "BTC/USDT:USDT" }
const INSTRUMENT_MAP: Record<string, InstrumentMapping> = {
  "BTC-PERP":  { exchange: "binance", symbol: "BTC/USDT:USDT" },
  "ETH-PERP":  { exchange: "binance", symbol: "ETH/USDT:USDT" },
  "SOL-PERP":  { exchange: "binance", symbol: "SOL/USDT:USDT" },
  "BNB-PERP":  { exchange: "binance", symbol: "BNB/USDT:USDT" },
};
```

If `resolveInstrument` returns null (unknown instrument), the route falls back to SAMPLE_CANDLES.

## Configuring a Backtest Run

POST body fields (all optional):

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| initialCapital | number | 10000 | Starting equity |
| feeBps | number | 10 | Taker fee in basis points (10 = 0.1%) |
| startTime | ISO string | now − 90 days | Query window start |
| endTime | ISO string | now | Query window end |

## Chart Alignment

The bars route (`/api/strategies/:id/bars`) uses the same `TimescaleRepository.queryCandles()` call as the backtest data loader, so the chart overlay and backtest candles come from the same source. When real data is available, the candlestick chart and backtest equity markers are time-aligned.

## Recommended Next Steps for Quant-Grade Backtesting

1. **Walk-forward**: Support multiple non-overlapping windows for robustness testing
2. **Metrics**: Add Sharpe, Sortino, Calmar; benchmark vs buy-and-hold
3. **Slippage model**: Currently fixed; add configurable slippage (% of spread or fixed bps)
4. **Async runs**: For large datasets, queue run and poll (worker process or serverless)
5. **More instruments**: Run `npm run ingest -- --symbol "ETH/USDT:USDT"` and add to INSTRUMENT_MAP
