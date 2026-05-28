# Backtest

## Current Architecture

- **Entry**: POST `/api/strategies/:id/backtests`
- **Engine**: `lib/backtest/backtest.ts` wraps `lib/strategy/engine` (compile, step, forceClose); accumulates funding cost per bar
- **Metrics**: `lib/backtest/metrics.ts` — `computeMetrics` extracted from `backtest.ts`; computes all performance metrics including risk-adjusted ratios and benchmark
- **Funding**: `lib/backtest/funding.ts` — `barFundingCost` computes USD funding cost for one bar using stored `funding_rates` hypertable data
- **Data**: `lib/backtest/data-loader.ts` → `BacktestDataLoader` → queries TimescaleDB; falls back to `SAMPLE_CANDLES` (60 synthetic bars) when real data is unavailable
- **Export**: GET `/api/backtests/:runId/export` — downloads a CSV file with METRICS, TRADES, and EQUITY_CURVE sections
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
- **Metrics**: totalReturnPct, netPnl, maxDrawdownPct, winRate, numberOfTrades, avgWin, avgLoss, profitFactor, sharpe (annualized), sortino (annualized), calmar (annualized return / max drawdown), benchmarkReturnPct (buy-and-hold over the same window), fundingCostPaid (total USD funding fees; positive = paid, negative = received)

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
| feeBps | number | 5 | Taker fee in basis points (5 = 0.05%) |
| startTime | ISO string | now − 90 days | Query window start |
| endTime | ISO string | now | Query window end |

## Chart Alignment

The bars route (`/api/strategies/:id/bars`) uses the same `TimescaleRepository.queryCandles()` call as the backtest data loader, so the chart overlay and backtest candles come from the same source. When real data is available, the candlestick chart and backtest equity markers are time-aligned.

## Funding Rate Integration

Funding rates are loaded on the real-data path after candles are resolved:

1. The backtest route calls `repo.queryFundingRates({ exchange, symbol, from, to })` against the `funding_rates` hypertable.
2. The result (a `FundingRate[]` array) is passed to `runBacktest` via `BacktestConfig.fundingRates`.
3. Inside the simulation loop, each bar calls `barFundingCost(fundingRates, position, barOpenMs, barCloseMs, barClosePrice)` which sums all funding events whose `funding_time` falls within `[barOpenMs, barCloseMs)` and multiplies by position size × mark price.
4. The bar's cost is added to `cumulativeFundingCost`; `reportEquity()` subtracts both trading fees and cumulative funding cost from equity at every snapshot.
5. The total `fundingCostPaid` is forwarded to `computeMetrics` and stored in `BacktestRun.metrics`.

**When it applies**: funding is only deducted when `fundingRates` is non-empty (i.e., when TimescaleDB has data for the instrument and window). If no funding data is available, the field is 0 and equity is unaffected.

**Positive vs negative**: positive `fundingCostPaid` means longs paid shorts (cost deducted); negative means shorts paid longs (credit added to equity).

**Best-effort loading**: if the DB is unavailable when loading funding rates, the error is silently swallowed and `fundingRates` remains empty. The `fundingRatesLoaded` count (0 or N) is stored in `run.log` for transparency.

## Export Endpoint

`GET /api/backtests/:runId/export`

Returns a CSV file attachment for a completed backtest run. The response sets `Content-Disposition: attachment; filename="backtest-<runId>.csv"`.

**CSV structure** — comment header block followed by three labeled sections:

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
Number of Trades,...
Avg Win,...
Avg Loss,...
Profit Factor,...
Sharpe Ratio,...
Sortino Ratio,...
Calmar Ratio,...
Benchmark Return %,...
Funding Cost Paid,...

# TRADES
Side,Entry Time,Entry Price,Exit Time,Exit Price,Qty,PnL,Reason Open,Reason Close
...

# EQUITY_CURVE
Time,Equity
...
```

The filename is `backtest-<runId[:8]>.csv` (first 8 chars of the UUID).

**Errors**:
- `404` — run not found
- `400` — run exists but status is not `completed`

## Recommended Next Steps for Quant-Grade Backtesting

1. **Walk-forward**: Support multiple non-overlapping windows for robustness testing (pending)
2. ~~**Metrics**: Add Sharpe, Sortino, Calmar; benchmark vs buy-and-hold~~ — resolved in Phase 5; see `metrics.ts`
3. **Slippage model**: Currently fixed; add configurable slippage (% of spread or fixed bps) (pending)
4. **Async runs**: For large datasets, queue run and poll (worker process or serverless)
5. ~~**More instruments**: Run `npm run ingest -- --symbol "ETH/USDT:USDT"` and add to INSTRUMENT_MAP~~ — resolved; multi-exchange INSTRUMENT_MAP entries added in Phase 4
6. ~~**CSV export**~~ — resolved in Phase 5; `GET /api/backtests/:runId/export`
7. ~~**Funding rate cost**~~ — resolved in Phase 5; `barFundingCost` deducts per-bar from equity
