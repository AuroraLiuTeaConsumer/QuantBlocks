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

When `replaySpeed` is supplied, the session enters worker-mode replay and the background paper worker advances the session at the requested rate until it catches up to the live edge. `replayUntil` is stored as a live-edge marker and cleared once real-time parity is reached.

## Session Lifecycle

1. **Idle**: No session or status=idle; Reset clears trades and engineState
2. **Running**: status=running; each poll processes bars, steps engine, persists trades
3. **Stopped**: status=stopped; Stop force-closes position, records closing trade

## Start / Stop / Reset Behavior

| Action | Endpoint | Behavior |
|--------|----------|----------|
| Resume | GET `/api/strategies/:id/paper/session` | Returns most recent `running` or `stopped` session (200), or 404 if none. Used on panel mount to restore state after refresh or tab switch. |
| Start | POST `/api/strategies/:id/paper/start` | Create session or return existing running session. Seeds `lastPrice` from the most recent TimescaleDB candle (falls back to 100 if unavailable). Body: `{ replayFrom?: ISO string, replaySpeed?: number }`. `replaySpeed` enables worker-mode accelerated replay and is capped at 600 bars/sec. **409** if a session is already running and caller sends a different `replayFrom`. |
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

## Timeframe Selection

The strategy's `timeframe` field is user-selectable. In the strategies list, a `<select>` populated from the canonical `TIMEFRAMES` tuple (`"1m","3m","5m","15m","30m","1h","4h","1d"`) lets the user choose a timeframe when creating a new strategy (defaults to `"1h"`). The workspace header uses a trading-style segmented interval strip with one-click buttons and a highlighted active timeframe. Changing it calls `PUT /api/strategies/:id` optimistically and reverts on error. Both `POST /api/strategies` and `PUT /api/strategies/:id` validate the supplied timeframe against the `TIMEFRAMES` enum at write time (returning `400` for invalid values), so the runtime paper/backtest routes no longer receive invalid timeframes.

The workspace disables the interval strip while a paper session is starting or running. `PaperTradingPanel` reports live session status to the workspace, so the buttons are re-enabled after stop/reset without a page reload. The `PUT /api/strategies/:id` route also rejects an actual timeframe change with `409` while a running paper session exists.

The market-price chart has a separate **Price interval** strip. It changes only the displayed OHLC bars and does not mutate the strategy or paper-session timeframe. Backtests refetch the completed run's date range at the selected interval. Paper sessions replace the displayed price series at the current replay cursor while retaining the execution-timeframe equity curve and trade markers; when the display interval differs from the session timeframe, price bars are refreshed as the cursor advances. If the selected interval is not stored directly, the bars endpoint accurately resamples an available finer series; it never splits coarse candles into fabricated finer prices.

## Performance Metrics

Paper trading displays the same performance set as backtesting: return, net PnL, Sharpe, Sortino, Calmar, maximum drawdown, win rate, closed-trade count, benchmark return, and funding cost. The engine state persists a compact performance accumulator (return sums, downside deviation input, high-water mark, trade aggregates, and benchmark endpoints), allowing the metrics to use the backtest formulas and survive page reloads without storing an unbounded equity curve. Live account fields such as current price, equity, realized/unrealized PnL, position, and entry price remain in a separate snapshot row.

## Instrument Resolution

Paper sessions inherit `instrument` and `timeframe` from the strategy at session start. The poll route resolves via `INSTRUMENT_MAP` (e.g. `BTC-PERP` → Binance `BTC/USDT:USDT`). If the instrument is unmapped or has no TimescaleDB data, the poll returns the current snapshot unchanged (session stalls until data is ingested).

## Concurrency

Concurrent polls (e.g. multiple browser tabs) use an optimistic lock on `PaperSession.updatedAt`:
- Winner persists engine state, `barCursor`, and trades.
- Loser re-fetches the session and retries up to **3** times, replaying the next candle batch from the updated cursor.
- After 3 failed attempts, the route returns the latest DB snapshot; the client picks up on the next 1s poll.

## In-Memory Limitations

- Execution is **not** continuous by default; it advances only when a client polls.
- Sessions started with `replaySpeed` may use the background worker to advance automatically until the live edge is reached.
- Replay is capped at 5 candles per poll to keep the UI responsive for normal polling sessions.
- If no data is ingested for the instrument, the session stalls (poll returns unchanged snapshot)

## Trade Persistence

Trade deduplication:
- `OPENED` → buffer new record (exitTime=null)
- `CLOSED` same-batch → fill in-place (one DB record)
- `CLOSED` cross-poll → `findFirst` open trade by ID, then `update` that row
