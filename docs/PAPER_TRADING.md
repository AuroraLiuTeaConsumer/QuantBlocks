# Paper Trading

## Current Architecture

- **Engine**: `lib/strategy/engine` — compileGraph, step, createInitialState
- **State**: PaperSession.engineState (JSON-serialized EngineState)
- **Execution**: Poll-based; GET `/api/paper/:sessionId` advances engine when status=running

## Session Lifecycle

1. **Idle**: No session or status=idle; Reset clears trades and engineState
2. **Running**: status=running; each poll simulates bars, steps engine, persists trades
3. **Stopped**: status=stopped; Stop force-closes position, records closing trade

## Start / Stop / Reset Behavior

| Action | Endpoint | Behavior |
|--------|----------|----------|
| Start | POST `/api/strategies/:id/paper/start` | Create session or return existing running session |
| Stop | POST `/api/paper/:sessionId/stop` | Force-close position, set status=stopped |
| Reset | POST `/api/paper/:sessionId/reset` | Delete PaperTrades, set status=idle, clear engineState |

## Polling and Hydration Model

- **Session poll** (1s): GET `/api/paper/:sessionId` → server computes elapsed time, simulates up to 10 bars per poll, steps engine, updates session, returns snapshot
- **Trades poll** (3s): GET `/api/paper/:sessionId/trades` → list of PaperTrades
- Client streams equity/price to chart via `appendFromSnapshot`; markers from trades

## In-Memory Limitations

- Execution is **not** continuous; it advances only when a client polls
- No background worker; if no one polls, session does not advance
- Simulated bars: `simulateBar(lastPrice, timeSec)` — random walk ±0.5%
- Bar interval from timeframe (e.g. 1h → 3_600_000 ms); bars capped at 10 per poll

## Why Session Persistence Across Panel Switches Matters

- When user switches from Paper tab to Backtest tab, PaperTradingPanel unmounts
- On return, panel mounts fresh; session may still exist in DB (if running)
- **Current behavior**: No automatic "resume"; user must Start again (which returns existing running session) or see idle until they Start
- **Risk**: If session was running, polling stops on unmount; session advances only when user returns and polling restarts. Gaps in simulated time.

## Recommended Design for Future Exchange Simulation

1. **Background worker**: Separate process or cron that polls/advances running sessions on schedule
2. **Real feed**: Integrate exchange WebSocket or REST for price updates instead of simulateBar
3. **Resume UX**: On mount, fetch session for strategy; if running, resume polling and chart
4. **Order simulation**: Model limit/market fills, partial fills, latency
5. **Multi-session**: Support multiple sessions per strategy (e.g. different configs) with clear naming
