# TODO

## Resolved

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Dual engine divergence | ✅ Unified — both backtest and paper use `lib/strategy/engine`; `compiler.ts` deleted |
| 2 | Bars are synthetic | ✅ Resolved for backtest/chart — TimescaleDB + CCXT ingestion live; synthetic fallback kept |
| 3 | Backtest uses fixed SAMPLE_CANDLES | ✅ BacktestDataLoader queries real candles with configurable date range |
| 12 | Funding rates ingestion | ✅ `FundingRateIngestionService` + `funding_rates` hypertable + API routes |
| 13 | Open interest ingestion | ✅ `OpenInterestIngestionService` + `open_interest` hypertable + API routes |
| 14 | Gap detection UI / coverage dashboard | ✅ `/market-data` server page showing candle/FR/OI series + job history |
| 15 | Data quality checks | ✅ `QualityChecker` validates OHLC, volume, price spikes per batch before insert |
| 16 | Multi-exchange ingestion | ✅ Bybit + OKX in EXCHANGE_CONFIGS + INSTRUMENT_MAP entries + CLI `--exchange` flag |

## Active / In Progress

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| 4 | Paper bars still synthetic | No real market simulation | Phase 3: replace with live Redis stream |
| 5 | Paper execution only on poll | Gaps when tab hidden | Accept limitation; Phase 3 adds background worker |

## Medium Priority

| # | Issue | Notes |
|---|-------|-------|
| 6 | Session resume on tab switch | Paper panel unmounts; no "resume session" UX |
| 7 | AI stub | Replace with real LLM translation (GPT-4 / Claude) |
| 8 | Strategy creation UX | No "New Strategy" in UI; only API/seed |
| 9 | Optimistic lock retry | Paper session update can fail; no retry on conflict |
| 10 | Auth / rate limiting | API routes unprotected |
| 11 | Error boundaries | Unhandled errors can blank page |
| 17 | OI availability | `fetchOpenInterestHistory` not supported on all CCXT exchanges; job records failure |
| 18 | Coverage dashboard refresh | Page is static server-render; requires manual reload to reflect new data |
| 19 | Quality report in BacktestPanel | `QualityReport` stored in `IngestionJob.meta` but not surfaced in the UI yet |

## Phase 3 — Live Feed

| # | Item |
|---|------|
| 20 | Native Hyperliquid adapter (REST + WebSocket) |
| 21 | Live WebSocket candle feed → Redis pub/sub |
| 22 | Paper trading advances on live Redis stream (replace poll) |
| 23 | Session replay from recorded stream |

## Phase 4 — Derivatives Data

| # | Item |
|---|------|
| 24 | CoinGlass liquidations data |
| 25 | Aggregated long/short ratios across exchanges |
| 26 | CoinGlass OI aggregation (cross-exchange) |

## Longer-Term Quant Features

| # | Item |
|---|------|
| 27 | Walk-forward / robustness testing |
| 28 | Order simulation (limit orders, partial fills) |
| 29 | Metrics: Sharpe, Sortino, Calmar, benchmark vs buy-and-hold |
| 30 | Multi-instrument strategy support |
| 31 | Async backtest runs (queue + poll for large datasets) |
| 32 | Funding rate cost factored into backtest PnL |

## Nice-to-Have

| # | Item |
|---|------|
| 33 | Dark/light theme toggle |
| 34 | Strategy templates / examples |
| 35 | Export backtest results (CSV) |
| 36 | Keyboard shortcuts for canvas |
| 37 | Mobile/responsive improvements |
| 38 | Coverage dashboard auto-refresh |
