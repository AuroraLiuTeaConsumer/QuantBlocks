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

# 4. Market data schema (TimescaleDB hypertables — run once)
#    Creates: candles, funding_rates, open_interest
npm run setup:timescale

# 5. Ingest real historical candles (Binance BTC/USDT:USDT 1h, 90 days)
npm run ingest

# 6. (Optional) Ingest funding rates and open interest
npm run ingest -- --dataType funding_rate
npm run ingest -- --dataType open_interest --timeframe 1h

# 7. Run
npm run dev
```

Steps 4–6 are optional. The app falls back to a synthetic 60-bar sample if no real data is available. The backtest panel shows an amber "⚠ Sample" badge in that case.

Open [http://localhost:3000](http://localhost:3000).  
Market data dashboard: [http://localhost:3000/market-data](http://localhost:3000/market-data)

## Env Vars

| Var | Required | Notes |
|-----|----------|-------|
| DATABASE_URL | Yes | PostgreSQL connection string — used by both Prisma and TimescaleDB raw pool |

Example:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/quantblocks"
```

No other env vars are currently required (Binance public OHLCV is unauthenticated; CCXT requires no API keys for historical data).

## Scripts

| Script | Command | Notes |
|--------|---------|-------|
| Dev server | `npm run dev` | Next.js dev, port 3000 |
| Build | `npm run build` | Production build |
| Start (prod) | `npm run start` | Serve production build |
| Lint | `npm run lint` | ESLint |
| Format | `npm run format` | Prettier |
| Tests | `npm run test` | Vitest, watch mode |
| Setup TimescaleDB | `npm run setup:timescale` | Run `db/migrations/timescale/*.sql` in order |
| Ingest candles | `npm run ingest` | Binance BTC/USDT:USDT 1h, 90 days |
| Ingest (custom) | `npm run ingest -- --exchange bybit --symbol "BTC/USDT:USDT" --timeframe 1h --days 180` | |
| Ingest funding rates | `npm run ingest -- --dataType funding_rate --days 365` | |
| Ingest open interest | `npm run ingest -- --dataType open_interest --timeframe 1h` | |

## Prisma

- **Migrate**: `npx prisma migrate dev`
- **Generate client**: `npx prisma generate` (run after schema changes)
- **Seed**: `npx prisma db seed`
- **Studio**: `npx prisma studio` (GUI inspector)

## Two Migration Tracks

| Track | Tool | Schema | When to run |
|-------|------|---------|-------------|
| App tables | Prisma (`prisma/schema.prisma`) | Strategy, BacktestRun, Trade, PaperSession, PaperTrade, IngestionJob | `npx prisma migrate dev` |
| TimescaleDB hypertables | Raw SQL (`db/migrations/timescale/*.sql`) | candles, funding_rates, open_interest | `npm run setup:timescale` (once) |

`npm run setup:timescale` runs all `db/migrations/timescale/*.sql` files in sorted order (001, 002, 003…). It is safe to re-run — every statement uses `IF NOT EXISTS`.

After adding a new Prisma model: always run `npx prisma generate` to update the TypeScript client.

## Debugging Tips

- **App DB**: Prisma Studio (`npx prisma studio`) — Strategy, BacktestRun, PaperSession, IngestionJob
- **TimescaleDB candles**: `psql $DATABASE_URL -c "SELECT count(*) FROM candles WHERE exchange='binance'"`
- **TimescaleDB funding**: `psql $DATABASE_URL -c "SELECT count(*) FROM funding_rates"`
- **TimescaleDB OI**: `psql $DATABASE_URL -c "SELECT count(*) FROM open_interest"`
- **Coverage dashboard**: Browse to `/market-data` — shows per-series bar counts and recent jobs
- **API data source**: Check `X-Data-Source` header from `/api/strategies/:id/bars`
- **Backtest data source**: `BacktestRun.log.dataSourceLabel` — or see the badge in BacktestPanel
- **Graph validation**: `npm run test` — 25 tests across validator, engine, backtest
- **Paper state**: `engineState` in PaperSession JSON (Prisma Studio)
- **Quality report**: `IngestionJob.meta` or console logs during `npm run ingest`

## Common Failure Cases

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Strategy not found" | Invalid ID | Use existing strategy from seed |
| Backtest shows "⚠ Sample" badge | No real data in TimescaleDB | `npm run setup:timescale && npm run ingest` |
| `X-Data-Source: synthetic` on bars | TimescaleDB not running or no data | Start Docker; run ingest |
| Prisma connection error | DATABASE_URL wrong or DB down | Verify PostgreSQL running |
| `extension "timescaledb" must be preloaded` | Old Docker volume from plain postgres image | `docker-compose down -v && docker-compose up -d` |
| `prisma.ingestionJob` not found | Prisma client not regenerated | `npx prisma generate` |
| `@rollup/rollup-darwin-x64` missing | Platform binary not installed | `npm install` |
| OI ingestion fails | Exchange doesn't support `fetchOpenInterestHistory` | Known limitation — only Binance futures and some Bybit/OKX endpoints support it |
| CCXT rate limit errors | Network throttling from exchange | Rate limiter set to 70% of RPM; wait and retry |
| Paper session not advancing | No one polling | Keep Paper tab visible |

## End-to-End Verification

1. **Coverage dashboard**: Browse `/market-data` — confirms candle, funding rate, OI row counts
2. **Real bars**: GET `/api/strategies/:id/bars?timeframe=1h` — check `X-Data-Source: real:binance:BTC/USDT:USDT`
3. **Real backtest**: Open BTC-PERP strategy → Backtest → expect "● Live" badge and bar count
4. **Funding rates**: GET `/api/market-data/funding-rates?instrument=BTC-PERP&limit=5` after running `npm run ingest -- --dataType funding_rate`
5. **Multi-exchange**: `npm run ingest -- --exchange bybit --symbol "BTC/USDT:USDT"` → check `/market-data` dashboard for new series
6. **Quality report**: Run ingest; check console for `[quality]` lines and summary
