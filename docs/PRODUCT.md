# Product

## Positioning

QuantBlocks = **TradingView + Hyperliquid + AI Strategy Builder**: visual strategy design, backtesting, paper trading, and planned live exchange integration.

## Target Users

- Traders/quant researchers who want to prototype strategies visually.
- Users who prefer graph-based logic over code.
- Future: users wanting direct Hyperliquid execution.

## Core Workflows

1. **Strategy creation**: Currently via API or seed; no in-app "Create Strategy" flow.
2. **Strategy editing**: Open `/strategies/:id` → edit graph in canvas → autosave or manual save.
3. **AI draft**: Enter prompt in left panel → Generate → Apply or Cancel. Stub returns fixed RSI strategy.
4. **Backtest**: Click Run Backtest → poll until complete → view metrics, equity curve, trades.
5. **Paper trading**: Click Start → session runs; poll advances simulated bars → view stats and trades. Stop or Reset when done.

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
| Bars | Synthetic random-walk | Real exchange (Hyperliquid, etc.) |
| Backtest data | 60 fixed candles | Configurable range, real historical |
| Paper bars | Simulated per poll | Real or replay feed |
| AI | Stub (fixed RSI) | LLM translation |
| Exchange | None | Hyperliquid paper/live |
| Session persistence | DB only | UI survives tab switch |

## Why Real Historical Data Is Pending

- Bars route (`/api/strategies/:id/bars`) is implemented as synthetic random-walk for development and demo.
- Backtest uses `SAMPLE_CANDLES` in `lib/data/candles.ts` — hardcoded 60 bars.
- Real data requires: exchange API integration, storage/caching, date-range queries, and alignment with strategy timeframe. Not yet implemented.
