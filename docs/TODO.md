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
| 20 | Native Hyperliquid adapter | ✅ `NativeHyperliquidProvider` — REST candleSnapshot + fundingHistory endpoints |
| 21 | WebSocket live candle ingestion | ✅ `ws-ingest.job.ts` — Binance USDT-M kline stream, native Node.js WebSocket, auto-reconnect |
| 22 | Real-bar paper trading | ✅ Poll route always replays TimescaleDB candles via `barCursor`; synthetic random-walk removed; `useRealBars` always true on create |
| 24 | CoinGlass liquidations data | ✅ `CoinGlassProvider` + `LiquidationIngestionService` + `liquidations` hypertable + GET/POST API routes + CLI + coverage dashboard section |
| 25 | Aggregated long/short ratios across exchanges | ✅ `LongShortRatioIngestionService` + `long_short_ratios` hypertable + GET/POST API routes + CLI + coverage dashboard section |
| 27 | CoinGlass timeframe validation gap | ✅ `isCGTimeframe()` check added before job record creation in both API route and CLI; unsupported timeframes return 400/exit(1) instead of silently falling back to `1h` |
| 29 | Metrics: Sharpe, Sortino, Calmar, benchmark vs buy-and-hold | ✅ Phase 5 — `lib/backtest/metrics.ts`; all four added to `BacktestMetrics` and displayed in BacktestPanel (10-card grid) |
| 32 | Funding rate cost factored into backtest PnL | ✅ Phase 5 — `lib/backtest/funding.ts` `barFundingCost`; deducted per bar from equity; `fundingCostPaid` in metrics; best-effort DB load in backtest route |
| 35 | Export backtest results (CSV) | ✅ Phase 5 — `GET /api/backtests/:runId/export`; CSV with METRICS, TRADES, EQUITY_CURVE sections; "Export CSV" button in BacktestPanel |
| 7 | AI stub → real LLM | ✅ `POST /api/ai/translateStrategy` now calls `claude-sonnet-4-6`; system prompt covers all node types, handle names, and validation rules; `validateGraph()` check with one self-correction retry; requires `ANTHROPIC_API_KEY` env var |
| 8 | Strategy creation UX | ✅ "New Strategy" button + inline name form on `/strategies` already existed; unblocked by removing `validateGraph` from POST (blank canvas is valid) and PUT (canvas saves incremental states; backtest uses `validateGraph`, paper uses `compileGraph` at run time) |
| 6 | Session resume on tab switch | ✅ New `GET /api/strategies/:id/paper/session` returns most recent running/stopped session. `PaperTradingPanel` calls it on mount: running → resume polling; stopped → load trades. Brief spinner suppresses idle state during check. |
| 9 | Optimistic lock retry | ✅ `GET /api/paper/:sessionId` now retries up to 3 times on lock collision: re-fetches the session (fresh `updatedAt` + `barCursor`), replays bars from the new cursor, retries the `updateMany`. After all retries exhausted returns the latest DB snapshot; client retries on the next 1s poll interval. |
| 10 | Auth / rate limiting | ✅ `src/middleware.ts` — same-origin enforcement on all frontend routes; `x-api-key` required for `/api/market-data/ingest`, `/api/internal/*`, `/api/admin/*`; in-memory fixed-window rate limiting by route category (ai: 10/min, backtests: 20/min, paper-poll: 120/min, paper-control: 20/min, market-candles: 60/min, default: 60/min). Set `QUANTBLOCKS_API_KEY` env var to protect internal routes; omit in dev to allow without key. Replace `_rlStore` with Redis/Upstash and add NextAuth before multi-user deployment. |
| 11 | Error boundaries | ✅ `src/components/ErrorBoundary.tsx` — reusable class component (label + Retry); wraps StrategyCanvas, AiPromptPanel, BacktestPanel, PaperTradingPanel independently in `StrategyWorkspace`; Next.js `error.tsx` added for `/strategies`, `/strategies/[id]`, `/market-data` routes. |
| 17 | OI availability | ✅ `open-interest-service.ts` — `isUnsupportedError()` detects permanent capability gaps; `fetchWithRetry` skips retries for them; `ingest()` returns `{ rowsInserted: 0 }` (completed) instead of throwing (failed) when the exchange lacks `fetchOpenInterestHistory`. |
| 18 | Coverage dashboard refresh | ✅ `app/market-data/page.tsx` — `force-dynamic` prevents caching; `MarketDataRefresher.tsx` client component calls `router.refresh()` via `useTransition` every 30s + on button click; shows last-updated time and spinner. Resolves #38 too. |
| 19 | Quality report in BacktestPanel | ✅ `QualityReport` now stored in `BacktestRun.log.dataQuality` (captured during auto-ingest) and in `IngestionJob.meta` from both API route and CLI. `BacktestPanel` renders a compact quality row after metrics grid: bar count + per-issue breakdown (OHLC errors, negative prices, volume errors, price spikes) or "✓ Clean". |

**Phase 5 summary**: extracted `computeMetrics` into `lib/backtest/metrics.ts`; added risk-adjusted ratios (Sharpe, Sortino, Calmar) and benchmark return; added per-bar funding cost via `lib/backtest/funding.ts` with best-effort DB load; added CSV export endpoint; expanded BacktestPanel metrics grid from 6 to 10 cards; no DB/Prisma schema changes required.

## Active / In Progress

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| 5 | Paper execution only on poll | Gaps when tab hidden | Accept limitation; future: background worker |

## Medium Priority

| # | Issue | Notes |
|---|-------|-------|
| ~~6~~ | ~~Session resume on tab switch~~ | ✅ Resolved — see Resolved table |
| ~~7~~ | ~~AI stub~~ | ✅ Resolved — see Resolved table |
| ~~8~~ | ~~Strategy creation UX~~ | ✅ Resolved — see Resolved table |
| ~~9~~ | ~~Optimistic lock retry~~ | ✅ Resolved — see Resolved table |
| ~~10~~ | ~~Auth / rate limiting~~ | ✅ Resolved — see Resolved table |
| ~~18~~ | ~~Coverage dashboard refresh~~ | ✅ Resolved — see Resolved table |
| ~~38~~ | ~~Coverage dashboard auto-refresh~~ | ✅ Resolved — see Resolved table |
| ~~11~~ | ~~Error boundaries~~ | ✅ Resolved — see Resolved table |
| ~~17~~ | ~~OI availability~~ | ✅ Resolved — see Resolved table |
| ~~19~~ | ~~Quality report in BacktestPanel~~ | ✅ Resolved — see Resolved table |

## Phase 4 (Next) — Redis + Advanced Live

| # | Item |
|---|------|
| 23 | Redis pub/sub: broadcast closed candles to all open sessions |
| 39 | Paper trading driven by live Redis stream (background worker, no poll needed) |
| 40 | Session replay from stored stream |

## Phase 4 — Derivatives Data (remaining)

| # | Item |
|---|------|
| 26 | CoinGlass OI aggregation (cross-exchange) |

## Longer-Term Quant Features

| # | Item |
|---|------|
| 27 | Walk-forward / robustness testing |
| 28 | Order simulation (limit orders, partial fills) |
| 30 | Multi-instrument strategy support |
| 31 | Async backtest runs (queue + poll for large datasets) |

## Nice-to-Have

| # | Item |
|---|------|
| 33 | Dark/light theme toggle |
| 34 | Strategy templates / examples |
| 36 | Keyboard shortcuts for canvas |
| 37 | Mobile/responsive improvements |
| ~~38~~ | ~~Coverage dashboard auto-refresh~~ | ✅ Resolved with #18 |
