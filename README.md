# QuantBlocks

Strategy building + backtesting + paper execution workspace for BTC-PERP perpetual trading. Vision: **TradingView + Hyperliquid + AI Strategy Builder**.

## Product Vision

- **Visual Strategy Editor**: React Flow graph editor for drag-and-drop strategy design.
- **AI Strategy Draft**: Natural-language prompt → strategy graph (currently stub; planned LLM integration).
- **Backtesting**: Historical run against synthetic or real market data.
- **Paper Trading**: Live simulation with simulated bars (MVP in progress).
- **Future**: Real exchange integration (Hyperliquid), real historical data.

## Current Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 Strategy Canvas | ✅ Done | React Flow graph editor, node types (price, RSI, compare, open/close position, etc.) |
| M2 AI Strategy Draft | ✅ Done | Stub translator; always returns RSI strategy regardless of prompt |
| M3 Backtest | ✅ Done | Uses 60 synthetic candles, `SAMPLE_CANDLES`, runs synchronously |
| M3.5 Chart Upgrade | ✅ Done | TwoPaneChart: candlestick + equity, markers, crosshair sync |
| M4 Paper Trading | 🚧 In Progress | In-memory session, DB-persisted trades; synthetic bar simulation per poll |

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS |
| Graph Editor | @xyflow/react (React Flow) |
| Charts | Lightweight Charts v5.1.0 |
| Validation | Zod |
| Database | PostgreSQL + Prisma |
| Engine | Custom strategy runtime (see `lib/strategy/engine`, `lib/strategy/compiler`) |

## Local Development

```bash
# Install
npm install

# Database (requires running PostgreSQL)
cp .env.example .env   # Set DATABASE_URL
npx prisma migrate dev
npx prisma db seed

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Major Routes

| Route | Purpose |
|-------|---------|
| `/` | Home, link to strategies |
| `/strategies` | List all strategies |
| `/strategies/[id]` | Strategy workspace: canvas, AI panel, backtest + paper tabs |

## Known Limitations

- **Bars are synthetic**: `/api/strategies/:id/bars` returns random-walk OHLC, not real market data.
- **Backtest uses fixed sample**: 60 candles from `lib/data/candles.ts`; not configurable time range.
- **Paper trading**: Simulated bars from random walk; no real feed. Session state persisted in DB, but no background worker — execution happens on each GET poll.
- **AI strategy**: Stub only; returns same RSI strategy for any prompt.
- **Backtest fees/slippage**: Applied in `lib/backtest/backtest.ts` on top of shared engine fills at bar close (same as paper).

## Roadmap Summary

1. **M4 completion**: Robust paper session lifecycle, session persistence across panel switches.
2. **Real bars**: Hyperliquid or other exchange historical/streaming data.
3. **Unify engines**: Single shared engine for backtest + paper.
4. **LLM integration**: Replace AI stub with real translation.
5. **Live exchange**: Hyperliquid integration for paper/live execution.
