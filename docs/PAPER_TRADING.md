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

The `barCursor` starts at `replayFrom` (if provided at start time) or defaults to 90 days before session creation when null. The 90-day lookback matches the default ingestion window and avoids replaying from the beginning of the entire DB history.

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
- **Session poll** (1s, while running): GET `/api/paper/:sessionId` → up to 5 real candles per poll; steps engine; updates session; returns snapshot
- **Trades poll** (3s, while running): GET `/api/paper/:sessionId/trades` → list of PaperTrades
- Client streams equity/price to chart via `appendFromSnapshot`; markers from trades

## UI Controls

The PaperTradingPanel header shows:
- **Status badge**: idle / running / stopped / error
- **Replay from** date picker (when not running): optional start date for historical replay
- **Restoring spinner** on mount while checking for an existing session

## Instrument Resolution

Paper sessions inherit `instrument` and `timeframe` from the strategy. The poll route resolves via `INSTRUMENT_MAP` (e.g. `BTC-PERP` → Binance `BTC/USDT:USDT`). If the instrument is unmapped or has no TimescaleDB data, the poll returns the current snapshot unchanged (session stalls until data is ingested).

## In-Memory Limitations

- Execution is **not** continuous; it advances only when a client polls
- No background worker; if no one polls, session does not advance
- Replay is capped at 5 candles per poll to keep the UI responsive
- If no data is ingested for the instrument, the session stalls (poll returns unchanged snapshot)

## Trade Persistence

Trade deduplication:
- `OPENED` → buffer new record (exitTime=null)
- `CLOSED` same-batch → fill in-place (one DB record)
- `CLOSED` cross-poll → `updateMany({ where: { sessionId, exitTime: null } })`
