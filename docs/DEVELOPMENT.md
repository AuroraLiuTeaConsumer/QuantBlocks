# Development

## Local Setup

```bash
# 1. Clone and install
cd QuantBlocks
npm install

# 2. Start TimescaleDB (PostgreSQL + TimescaleDB extension)
docker-compose up -d

# 3. App database (Prisma tables)
cp .env.example .env       # set DATABASE_URL
npx prisma migrate dev
npx prisma db seed

# 4. Market data schema (TimescaleDB hypertable — run once)
npm run setup:timescale

# 5. Ingest real historical candles (Binance BTC/USDT:USDT 1h, 90 days)
npm run ingest

# 6. Run
npm run dev
```

Steps 4–5 are optional. The app falls back to a synthetic 60-bar sample if no real data is available. The backtest panel will show an amber "⚠ Sample" badge in that case.

Open [http://localhost:3000](http://localhost:3000).

## Env Vars

| Var | Required | Notes |
|-----|----------|-------|
| DATABASE_URL | Yes | PostgreSQL connection string — used by both Prisma and TimescaleDB raw pool |

`DATABASE_URL` must point to the TimescaleDB instance (same Postgres, same port). Example:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quantblocks"
```

No other env vars are currently required (no API keys for CCXT; Binance public OHLCV is unauthenticated).

## Scripts

| Script | Command | Notes |
|--------|---------|-------|
| Dev server | `npm run dev` | Next.js dev, port 3000 |
| Build | `npm run build` | Production build |
| Start (prod) | `npm run start` | Serve production build |
| Lint | `npm run lint` | ESLint |
| Format | `npm run format` | Prettier |
| Tests | `npm run test` | Vitest, watch mode |
| Setup TimescaleDB | `npm run setup:timescale` | Run `db/migrations/timescale/*.sql` once |
| Ingest candles | `npm run ingest` | Backfill Binance BTC/USDT:USDT 1h, 90 days |
| Ingest (custom) | `npm run ingest -- --symbol "ETH/USDT:USDT" --days 180` | Flags: `--exchange`, `--symbol`, `--timeframe`, `--days` |

## Prisma

- **Migrate**: `npx prisma migrate dev`
- **Generate client**: `npx prisma generate` (run after schema changes)
- **Seed**: `npx prisma db seed`
- **Studio**: `npx prisma studio` (GUI inspector)

## Two Migration Tracks

QuantBlocks uses two separate database migration systems:

| Track | Tool | Schema | When to run |
|-------|------|---------|-------------|
| App tables | Prisma (`prisma/schema.prisma`) | Strategy, BacktestRun, Trade, PaperSession, PaperTrade, IngestionJob | `npx prisma migrate dev` |
| TimescaleDB hypertable | Raw SQL (`db/migrations/timescale/*.sql`) | candles | `npm run setup:timescale` (once) |

After adding a new Prisma model, always run `npx prisma generate` to update the TypeScript client before using `prisma.<model>` in code.

## Debugging Tips

- **App DB**: Prisma Studio (`npx prisma studio`) — inspect Strategy, BacktestRun, PaperSession, IngestionJob
- **TimescaleDB data**: `psql $DATABASE_URL -c "SELECT count(*) FROM candles WHERE exchange='binance'"`
- **API responses**: Browser DevTools Network tab; API routes log to console in dev
- **Bars data source**: Check `X-Data-Source` response header from `/api/strategies/:id/bars` — `real:binance:BTC/USDT:USDT` or `synthetic`
- **Backtest data source**: `BacktestRun.log.dataSourceLabel` — or see the badge in BacktestPanel
- **Graph validation**: `npm run test` — includes `validator.test.ts`, `engine.test.ts`, `backtest.test.ts`
- **Paper state**: `engineState` in PaperSession — inspect JSON for nodeValues, position, indicators
- **Ingestion jobs**: `IngestionJob` rows in Prisma Studio — check `status`, `rowsInserted`, `error`

## Common Failure Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Strategy not found" | Invalid ID or missing row | Check DB; use existing strategy from seed |
| Save fails with validation errors | Invalid graph (cycle, missing nodes) | Fix graph in canvas; check validator output |
| Backtest fails | Invalid graph, missing open/close | Ensure graph has open_position and close_position |
| Backtest shows "⚠ Sample" badge | No real data in TimescaleDB | Run `npm run setup:timescale` then `npm run ingest` |
| Paper session not advancing | No one polling | Keep Paper tab visible; polling runs only when mounted |
| `X-Data-Source: synthetic` on bars | TimescaleDB not running or no data ingested | Start Docker container; run ingest |
| Prisma connection error | DATABASE_URL wrong or DB down | Verify PostgreSQL running; check connection string |
| `extension "timescaledb" must be preloaded` | Old Docker volume created by plain postgres image | `docker-compose down -v && docker-compose up -d` |
| `prisma.ingestionJob` not found on type | Prisma client not regenerated after schema change | `npx prisma generate` |
| `@rollup/rollup-darwin-x64` missing | Platform binary not installed | `npm install` |
| CCXT rate limit errors | Ingestion too aggressive | Already handled — rate limiter at 70% of RPM; wait and retry |

## How to Verify End-to-End

1. **Real bars**: GET `/api/strategies/:id/bars?timeframe=1h&limit=100` — check `X-Data-Source: real:binance:BTC/USDT:USDT`
2. **Real backtest**: Open a BTC-PERP strategy → Backtest tab → Run. Expect "● Live" badge and `dataSourceLabel` showing bar count.
3. **Chart**: After backtest, candlestick + equity pane should render with markers at entry/exit.
4. **Paper trading**: Paper tab → Start. Wait; poll advances session. Stats and trades update. Stop or Reset to end.
5. **Ingest more data**: `npm run ingest -- --symbol "ETH/USDT:USDT"` → create ETH-PERP strategy → backtest should use real ETH candles.
