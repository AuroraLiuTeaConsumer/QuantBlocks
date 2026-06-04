# Changelog: Current State

**Snapshot as of documentation generation.**

## Implemented Modules

### Strategy Canvas (M1)

- React Flow graph editor with 13 node types: price, volume, rsi, constant, compare, cross, and, or, not, open_position, close_position, set_risk
- Autosave (1.5s debounce) + manual Save
- PUT `/api/strategies/:id` — saves nodes/edges without server-side graph validation (incremental canvas edits)
- POST `/api/strategies` — create with `name` only; blank canvas valid; `/strategies` UI has "New Strategy" form
- Node types: `components/strategy/nodeTypes/*`

### AI Strategy Draft (M2)

- AiPromptPanel: textarea + Generate button
- POST `/api/ai/translateStrategy` — calls `claude-sonnet-4-6`; validates with `validateGraph()`; one self-correction retry; requires `ANTHROPIC_API_KEY`
- Apply / Cancel flow; Zod validation of response
- Draft → Apply → Save to canvas

### Backtest (M3)

- POST `/api/strategies/:id/backtests` — synchronous run
- Engine: `lib/backtest/backtest.ts` + `lib/strategy/compiler.ts`
- Data: 60 fixed candles from `lib/data/candles.ts`
- Metrics, equity curve, trades persisted
- Client poll GET `/api/backtests/:runId` (usually already completed)

### Chart Upgrade (M3.5)

- TwoPaneChart: top pane (candlestick or price line), bottom pane (equity)
- Trade markers (entry/exit)
- Crosshair sync between panes
- Streaming mode for paper trading

### Paper Trading (M4, In Progress)

- POST `/api/strategies/:id/paper/start` — create/resume session
- GET `/api/paper/:sessionId` — advance engine (simulated bars per poll)
- POST stop, reset; GET trades
- Engine: `lib/strategy/engine` (compileGraph, step)
- Session state in DB; trades persisted

## Critical Reality

- **Bars are synthetic.** `/api/strategies/:id/bars` returns random-walk OHLC. Backtest uses `SAMPLE_CANDLES` from `lib/data/candles.ts`, not the bars route.
- **Real exchange historical data integration is pending.** No Hyperliquid, Binance, or other exchange API for bars.
- **Paper trading uses simulated bars.** `simulateBar(lastPrice, timeSec)` — random walk; no real feed.
- **Two strategy engines exist.** Backtest uses `lib/strategy/compiler`; paper uses `lib/strategy/engine`. Logic duplicated; potential divergence.
