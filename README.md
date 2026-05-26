# QuantBlocks

Strategy research + backtesting + paper execution workspace for crypto perpetual trading.
Vision: **TradingView + Hyperliquid + AI Strategy Builder**.

## Product Vision

- **Visual Strategy Editor**: React Flow graph editor for drag-and-drop strategy design.
- **AI Strategy Draft**: Natural-language prompt → strategy graph (stub; LLM integration planned).
- **Backtesting**: Historical run against real market data from Binance via CCXT, stored in TimescaleDB. Falls back to a synthetic 60-bar dataset when no real data is ingested.
- **Paper Trading**: Live simulation (synthetic bars today; real feed in Phase 3).
- **Future**: Hyperliquid native adapter, live WebSocket feed, Redis pub/sub.

## Current Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 Strategy Canvas | ✅ Done | React Flow graph editor, all node types |
| M2 AI Strategy Draft | ✅ Done | Stub translator — always returns RSI strategy |
| M3 Backtest (shared engine) | ✅ Done | Single engine for backtest + paper; fees, slippage, metrics |
| M3.5 Chart Upgrade | ✅ Done | TwoPaneChart: candlestick + equity, markers, crosshair sync |
| M4 Paper Trading | 🚧 In Progress | Synthetic bars; real feed in Phase 3 |
| **M5 Real Market Data** | ✅ Done | TimescaleDB hypertable, CCXT ingestion, BacktestDataLoader |

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS |
| Graph Editor | @xyflow/react (React Flow) |
| Charts | Lightweight Charts v5.1.0 |
| Validation | Zod |
| App database | PostgreSQL + Prisma |
| Market data store | TimescaleDB (same PostgreSQL instance, raw SQL hypertable) |
| Market data fetch | CCXT (Binance perpetuals; Bybit/OKX next) |
| Data access | `pg` Pool (TimescaleDB); Prisma (app tables) |
| Engine | Custom strategy runtime (`lib/strategy/engine`) |

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start TimescaleDB
docker-compose up -d

# 3. App database (Prisma tables)
cp .env.example .env        # set DATABASE_URL
npx prisma migrate dev
npx prisma db seed

# 4. Market data schema (TimescaleDB hypertable — run once)
npm run setup:timescale

# 5. Ingest real historical candles (Binance BTC/USDT:USDT 1h, 90 days)
npm run ingest

# 6. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Steps 4–5 are optional: the app falls back to a synthetic 60-bar sample if no real data is available.

## Major Routes

| Route | Purpose |
|-------|---------|
| `/` | Home |
| `/strategies` | List strategies |
| `/strategies/[id]` | Strategy workspace: canvas, AI panel, backtest + paper tabs |

## Known Limitations

- **Paper trading bars**: Still synthetic random-walk. Phase 3 will replace with live Redis stream.
- **AI strategy**: Stub only — returns same RSI strategy for any prompt.
- **Paper execution on poll**: No background worker; engine advances only when the client tab is visible and polling.
- **Single instrument ingested by default**: Run `npm run ingest -- --symbol "ETH/USDT:USDT"` to add more.

## Roadmap

| Phase | Goal | Status |
|-------|------|--------|
| 1 | Real historical candles in backtest (CCXT → TimescaleDB) | ✅ Done |
| 2 | Funding rates, OI, gap detection, data quality checks | Planned |
| 3 | Native Hyperliquid adapter, live WebSocket, Redis pub/sub | Planned |
| 4 | CoinGlass derivatives data (liquidations, long/short ratios) | Planned |
| 5 | Paper trading on live Redis stream, session replay | Planned |
