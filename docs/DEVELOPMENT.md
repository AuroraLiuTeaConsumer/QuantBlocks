# Development

## Local Setup

```bash
# Clone (if applicable)
cd QuantBlocks

# Install
npm install

# Database
cp .env.example .env
# Edit .env: set DATABASE_URL (PostgreSQL)
npx prisma migrate dev
npx prisma db seed

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Env Vars Used or Expected

| Var | Required | Notes |
|-----|----------|-------|
| DATABASE_URL | Yes | PostgreSQL connection string (see .env.example) |

No other env vars currently used (e.g. no API keys for AI or exchange).

## How to Run App

- **Dev**: `npm run dev` — Next.js dev server
- **Build**: `npm run build`
- **Start** (prod): `npm run start`
- **Lint**: `npm run lint`
- **Format**: `npm run format`
- **Tests**: `npm run test` or `npm run test:watch`

## How to Run Prisma

- **Migrate**: `npx prisma migrate dev`
- **Generate client**: `npx prisma generate`
- **Seed**: `npx prisma db seed` (or `npx prisma db seed` after migrate)
- **Studio**: `npx prisma studio` (GUI)

## Debugging Tips

- **DB**: Use Prisma Studio to inspect Strategy, BacktestRun, PaperSession
- **API**: Use browser DevTools Network tab; API routes log to console in dev
- **Graph validation**: Run `npm run test` — includes `validator.test.ts`, `engine.test.ts`, `backtest.test.ts`
- **Paper state**: `engineState` in PaperSession; inspect JSON for nodeValues, position, indicators

## Common Failure Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Strategy not found" | Invalid ID or missing row | Check DB; use existing strategy from seed |
| Save fails with validation errors | Invalid graph (cycle, missing nodes) | Fix graph in canvas; check validator output |
| Backtest fails | Invalid graph, missing open/close | Ensure graph has open_position and close_position |
| Paper session not advancing | No one polling | Keep Paper tab visible; polling runs only when mounted |
| Bars unavailable | /api/strategies/:id/bars failing | Check strategy exists; bars route returns synthetic |
| Prisma connection error | DATABASE_URL wrong or DB down | Verify PostgreSQL running; check connection string |

## How to Verify Backtest, Chart, Paper Trading Manually

1. **Backtest**: Go to `/strategies`, open a strategy. Backtest tab → Run Backtest. Expect metrics, equity chart, trades. If bars unavailable, chart shows equity only.
2. **Chart**: After backtest completes, candlestick + equity should render; markers at entry/exit.
3. **Paper trading**: Paper tab → Start Paper Trading. Wait; poll advances session. Stats and trades update. Stop or Reset to end.
4. **Bars**: GET `/api/strategies/:id/bars?timeframe=1h&limit=100` returns JSON array of synthetic OHLC.
