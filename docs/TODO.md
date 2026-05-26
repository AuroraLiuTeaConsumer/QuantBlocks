# TODO

## Resolved

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Dual engine divergence | ✅ Unified — both backtest and paper use `lib/strategy/engine`; `compiler.ts` deleted |
| 2 | Bars are synthetic | ✅ Resolved for backtest/chart — TimescaleDB + CCXT ingestion live; synthetic fallback kept for resilience |
| 3 | Backtest uses fixed SAMPLE_CANDLES | ✅ BacktestDataLoader queries real candles from TimescaleDB with configurable date range |

## Active / In Progress

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| 4 | Paper bars still synthetic | No real market simulation | Phase 3: replace with live Redis stream from Hyperliquid/Binance WS |
| 5 | Paper execution only on poll | Gaps when tab hidden | Accept limitation for now; add background worker in Phase 3 |

## Medium Priority

| # | Issue | Notes |
|---|-------|-------|
| 6 | Session resume on tab switch | Paper panel unmounts; no "resume session" UX |
| 7 | AI stub | Replace with real LLM translation (GPT-4 / Claude) |
| 8 | Strategy creation UX | No "New Strategy" in UI; only API/seed |
| 9 | Optimistic lock retry | Paper session update can fail; no retry on conflict |
| 10 | Auth / rate limiting | API routes unprotected |
| 11 | Error boundaries | Unhandled errors can blank page |

## Phase 2 — Data Quality

| # | Item |
|---|------|
| 12 | Funding rates ingestion (CCXT `fetchFundingRateHistory`) |
| 13 | Open interest ingestion |
| 14 | Gap detection UI / dashboard for data coverage |
| 15 | Data quality checks: outlier prices, zero-volume bars, large gaps |
| 16 | Multi-exchange ingestion (Bybit, OKX) |

## Phase 3 — Live Feed

| # | Item |
|---|------|
| 17 | Native Hyperliquid adapter (REST + WebSocket) |
| 18 | Live WebSocket candle feed → Redis pub/sub |
| 19 | Paper trading advances on live Redis stream (replace poll) |
| 20 | Session replay from recorded stream |

## Phase 4 — Derivatives Data

| # | Item |
|---|------|
| 21 | CoinGlass liquidations data |
| 22 | Long/short ratios |
| 23 | Aggregated open interest across exchanges |

## Longer-Term Quant Features

| # | Item |
|---|------|
| 24 | Walk-forward / robustness testing |
| 25 | Order simulation (limit orders, partial fills) |
| 26 | Metrics: Sharpe, Sortino, Calmar, benchmark vs buy-and-hold |
| 27 | Multi-instrument strategy support |
| 28 | Async backtest runs (queue + poll for large datasets) |

## Nice-to-Have

| # | Item |
|---|------|
| 29 | Dark/light theme toggle |
| 30 | Strategy templates / examples |
| 31 | Export backtest results (CSV) |
| 32 | Keyboard shortcuts for canvas |
| 33 | Mobile/responsive improvements |
