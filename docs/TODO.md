# TODO

## Truth-Critical (Must-Fix)

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| 1 | Dual engine divergence | Backtest vs paper may behave differently | Migrate backtest to `lib/strategy/engine` or vice versa |
| 2 | Bars are synthetic | No real market data | Integrate exchange API (Hyperliquid) for historical bars |
| 3 | Backtest uses fixed SAMPLE_CANDLES | Not configurable date range | Add start/end params; fetch real candles |
| 4 | Paper execution only on poll | Gaps when tab hidden | Add background worker or accept limitation |

## Medium Priority

| # | Issue | Notes |
|---|-------|-------|
| 5 | Session resume on tab switch | Paper panel unmounts; no "resume session" UX |
| 6 | AI stub | Replace with LLM translation |
| 7 | Strategy creation UX | No "New Strategy" in UI; only API/seed |
| 8 | Optimistic lock retry | Paper session update can fail; no retry on conflict |
| 9 | Auth / rate limiting | API routes unprotected |
| 10 | Error boundaries | Unhandled errors can blank page |

## Longer-Term Roadmap

| # | Item |
|---|------|
| 11 | Real exchange integration (Hyperliquid) for paper/live |
| 12 | Configurable backtest date range, instrument |
| 13 | Walk-forward / robustness testing |
| 14 | Order simulation (limit orders, partial fills) |
| 15 | Metrics: Sharpe, Sortino, Calmar |

## Nice-to-Have

| # | Item |
|---|------|
| 16 | Dark/light theme toggle |
| 17 | Strategy templates / examples |
| 18 | Export backtest results (CSV) |
| 19 | Keyboard shortcuts for canvas |
| 20 | Mobile/responsive improvements |
