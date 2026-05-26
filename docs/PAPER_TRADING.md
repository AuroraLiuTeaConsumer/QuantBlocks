# Paper Trading

## Current Architecture

- **Engine**: `lib/strategy/engine` — compileGraph, step, createInitialState
- **State**: PaperSession.engineState (JSON-serialized EngineState)
- **Execution**: Poll-based; GET `/api/paper/:sessionId` advances engine when status=running

## Bar Sources

| Mode | Description |
|------|-------------|
| **Synthetic** (default) | Random-walk ±0.5% per bar, derived from elapsed wall-clock time. Works without any real data. |
| **Real Bars** | Reads closed candles from TimescaleDB (ordered by `open_time`) via `barCursor`. Requires real data to be ingested first (`npm run ingest`). |

### Real-bar replay

When `useRealBars=true` the poll route:
1. Resolves instrument → exchange + CCXT symbol via `INSTRUMENT_MAP`.
2. Queries `TimescaleRepository.queryCandles({ startTime: barCursor + 1ms, limit: 5 })`.
3. Feeds each returned candle as a `Bar` to the shared strategy engine.
4. Updates `PaperSession.barCursor` to the last processed candle's `open_time`.
5. If no new candles are available (replay is caught up), returns the current snapshot without advancing.

The `barCursor` starts at `replayFrom` (if provided) or at epoch 0 (→ earliest available candle in DB).

## Session Lifecycle

1. **Idle**: No session or status=idle; Reset clears trades and engineState
2. **Running**: status=running; each poll processes bars, steps engine, persists trades
3. **Stopped**: status=stopped; Stop force-closes position, records closing trade

## Start / Stop / Reset Behavior

| Action | Endpoint | Behavior |
|--------|----------|----------|
| Start | POST `/api/strategies/:id/paper/start` | Create session or return existing running session. Body: `{ useRealBars?: boolean, replayFrom?: ISO string }` |
| Stop | POST `/api/paper/:sessionId/stop` | Force-close position, set status=stopped |
| Reset | POST `/api/paper/:sessionId/reset` | Delete PaperTrades, set status=idle, clear engineState + barCursor |

## Polling and Hydration Model

- **Session poll** (1s): GET `/api/paper/:sessionId` → server processes up to 10 synthetic bars OR up to 5 real bars per poll; steps engine; updates session; returns snapshot
- **Trades poll** (3s): GET `/api/paper/:sessionId/trades` → list of PaperTrades
- Client streams equity/price to chart via `appendFromSnapshot`; markers from trades

## UI Controls

The PaperTradingPanel header shows:
- **Status badge**: idle / running / stopped / error
- **Data source badge** (while running): "Real Bars" (accent) or "Synthetic" (muted)
- **Real Bars checkbox** (when not running): toggles real-bar replay
- **Replay From date picker** (when Real Bars is checked): optional start date; defaults to earliest candle in DB

## Instrument Resolution

Paper sessions inherit `instrument` and `timeframe` from the strategy. Real-bar mode resolves the instrument via `INSTRUMENT_MAP` (e.g. `BTC-PERP` → Binance `BTC/USDT:USDT`). If the instrument has no TimescaleDB data the poll falls back to synthetic bars.

## In-Memory Limitations

- Execution is **not** continuous; it advances only when a client polls
- No background worker; if no one polls, session does not advance
- Real-bar replay is capped at 5 candles per poll to keep the UI responsive
- Synthetic bars are capped at 10 bars per poll

## Trade Persistence

Both modes use the same deduplication strategy:
- `OPENED` → buffer new record (exitTime=null)
- `CLOSED` same-batch → fill in-place (one DB record)
- `CLOSED` cross-poll → `updateMany({ where: { sessionId, exitTime: null } })`
