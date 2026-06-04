# Product

## Positioning

QuantBlocks = **TradingView + Hyperliquid + AI Strategy Builder**: visual strategy design, backtesting, paper trading, and planned live exchange integration.

## Target Users

- Traders/quant researchers who want to prototype strategies visually.
- Users who prefer graph-based logic over code.
- Future: users wanting direct Hyperliquid execution.

## Core Workflows

1. **Strategy creation**: `/strategies` → **New Strategy** → enter name → POST `/api/strategies` → opens workspace with empty canvas.
2. **Strategy editing**: Open `/strategies/:id` → edit graph in canvas → autosave (1.5s debounce). PUT saves without server-side graph validation; incomplete graphs are OK until backtest.
3. **AI draft**: Enter prompt in left panel → Generate → Apply or Cancel. `claude-sonnet-4-6` translates prompt; `validateGraph()` with one retry on failure.
4. **Backtest**: Click Run Backtest → poll until complete → view metrics, equity curve, trades.
5. **Paper trading**: Panel auto-resumes running/stopped sessions on open. Click Start (optional replay-from date) → poll replays TimescaleDB candles → view stats and trades. Stop or Reset when done.

## Milestone History

| Milestone | Delivered |
|-----------|-----------|
| M1 Strategy Canvas | React Flow graph editor, 13 node types (price, volume, RSI, constant, compare, cross, and, or, not, open/close/set_risk) |
| M2 AI Strategy Draft | Stub API, AiPromptPanel, apply/cancel flow, Zod validation |
| M3 Backtest | POST backtests, synchronous run, 60-sample candles, metrics, trades |
| M3.5 Chart Upgrade | TwoPaneChart (candlestick + equity), trade markers, crosshair sync |
| M4 Paper Trading | Session lifecycle (start/stop/reset), poll-based step, DB persistence, chart streaming |

## What Exists Now vs Planned

| Area | Now | Planned |
|------|-----|---------|
| Strategy creation | In-app "New Strategy" on `/strategies` | Instrument/timeframe picker on create |
| Bars / backtest | TimescaleDB real candles; synthetic fallback | More instruments, longer history |
| Paper bars | TimescaleDB candle replay (5 bars/poll) | Live Redis stream (background worker) |
| AI | Claude Sonnet graph translation | Richer prompts, templates |
| Exchange execution | None | Hyperliquid live |
| Session persistence | DB + auto-resume on paper tab mount | Restore streamed chart buffers |

## Data Sources

- **Backtest / chart bars**: `BacktestDataLoader` and bars API query TimescaleDB (CCXT-ingested); fall back to `SAMPLE_CANDLES` when coverage < 80% or DB unavailable.
- **Paper**: Replays stored candles after `barCursor`; not a live WebSocket feed. Requires ingested data for the strategy instrument.
