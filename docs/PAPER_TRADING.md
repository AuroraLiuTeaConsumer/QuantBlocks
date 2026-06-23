# Paper Trading

## Current Architecture

- **Engine**: `lib/strategy/engine` — compileGraph, step, createInitialState
- **State**: PaperSession.engineState (JSON-serialized EngineState)
- **Execution**: Poll-based; GET `/api/paper/:sessionId` advances engine when status=running

## Bar Source

Paper trading always uses **real candles from TimescaleDB** — synthetic random-walk bars have been removed. You must ingest historical data first (`npm run ingest`) before starting a paper session. If no candles are available for the instrument, the poll returns the current snapshot unchanged until data is ingested.

### Real-bar replay

On every poll the route:
1. Resolves instrument → exchange + CCXT symbol via `INSTRUMENT_MAP`.
2. Queries `TimescaleRepository.queryCandles({ startTime: barCursor + 1ms, limit: 5 })`.
3. Feeds each returned candle as a `Bar` to the shared strategy engine.
4. Updates `PaperSession.barCursor` to the last processed candle's `open_time`.
5. If no new candles are available (replay is caught up), returns the current snapshot without advancing.

The `barCursor` is resolved and persisted at session creation: `replayFrom` (if provided), otherwise 90 days before session creation. It is never left `null` — `paper/start` stores the resolved value up front so every snapshot reports the true replay anchor, not just explicit replays. This also lets the chart's bar-seeding request (`GET /api/strategies/:id/bars?end=<barCursor>`) anchor its window to end exactly where the replay begins, instead of "now" — see [Chart Seeding](#chart-seeding) below.

## Session Lifecycle

1. **Idle**: No session or status=idle; Reset clears trades and engineState
2. **Running**: status=running; each poll processes bars, steps engine, persists trades
3. **Stopped**: status=stopped; Stop force-closes position, records closing trade

## Start / Stop / Reset Behavior

| Action | Endpoint | Behavior |
|--------|----------|----------|
| Resume | GET `/api/strategies/:id/paper/session` | Returns most recent `running` or `stopped` session (200), or 404 if none. Used on panel mount to restore state after refresh or tab switch. |
| Start | POST `/api/strategies/:id/paper/start` | Create session or return existing running session. Seeds `lastPrice` from the most recent TimescaleDB candle (falls back to 100 if unavailable). Body: `{ replayFrom?: ISO string }`. **409** if a session is already running and caller sends a different `replayFrom`. |
| Stop | POST `/api/paper/:sessionId/stop` | Force-close position, set status=stopped |
| Reset | POST `/api/paper/:sessionId/reset` | Delete PaperTrades, set status=idle, clear engineState + barCursor. Re-seeds `lastPrice` from the most recent TimescaleDB candle (falls back to 100) so the next start begins at a realistic price. |

## Polling and Hydration Model

- **Mount**: GET `/api/strategies/:id/paper/session` — if `running`, resume session + trades polling; if `stopped`, load snapshot + trades without polling
- **Session poll** (1s, while running): GET `/api/paper/:sessionId` → up to 5 real candles per poll; steps engine; updates session; returns snapshot (includes `lastBar` OHLC)
- **Trades poll** (3s, while running): GET `/api/paper/:sessionId/trades` → list of PaperTrades
- Client streams equity/candle updates to chart via `appendFromSnapshot` (`TwoPaneChart.appendEquity` + `.appendBar`); markers from trades

## Chart Seeding

On mount/start, `PaperTradingPanel.fetchAndSeedBars` fetches historical context via `GET /api/strategies/:id/bars?end=<barCursor>&limit=500` and calls `TwoPaneChart.initBars` to pre-populate the candlestick series (`series.setData`) before live `appendBar` updates begin.

The `end` param **must** be the session's `barCursor`, not "now" — `lightweight-charts` series throw `Cannot update oldest data` if `.update()` is called with a time older than the last point in the series, and because the replay always starts well in the past (see Bar Source above), seeding up to "now" guarantees the first live `appendBar` call is older than the seeded data. That exception used to get silently swallowed by `pollSession`'s catch block before `lastEquityTimeRef` advanced, so it repeated on every 1s poll forever and the candlestick pane froze while the session kept running. Always anchor `end` to `barCursor`.

## UI Controls

The PaperTradingPanel header shows:
- **Status badge**: idle / running / stopped / error
- **Replay from** date picker (when not running): optional start date for historical replay
- **Restoring spinner** on mount while checking for an existing session

## Instrument Resolution

Paper sessions inherit `instrument` and `timeframe` from the strategy. The poll route resolves via `INSTRUMENT_MAP` (e.g. `BTC-PERP` → Binance `BTC/USDT:USDT`). If the instrument is unmapped or has no TimescaleDB data, the poll returns the current snapshot unchanged (session stalls until data is ingested).

## Concurrency

Concurrent polls (e.g. multiple browser tabs) use an optimistic lock on `PaperSession.updatedAt`:
- Winner persists engine state, `barCursor`, and trades.
- Loser re-fetches the session and retries up to **3** times, replaying the next candle batch from the updated cursor.
- After 3 failed attempts, the route returns the latest DB snapshot; the client picks up on the next 1s poll.

## In-Memory Limitations

- Execution is **not** continuous; it advances only when a client polls
- No background worker; if no one polls, session does not advance
- Replay is capped at 5 candles per poll to keep the UI responsive
- If no data is ingested for the instrument, the session stalls (poll returns unchanged snapshot)

## Trade Persistence

Trade deduplication:
- `OPENED` → buffer new record (exitTime=null)
- `CLOSED` same-batch → fill in-place (one DB record)
- `CLOSED` cross-poll → `findFirst` open trade by ID, then `update` that row
