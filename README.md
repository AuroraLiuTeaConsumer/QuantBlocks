# QuantBlocks

Strategy building + backtesting + paper execution workspace for Hyperliquid-style perpetual trading.

## Local Setup

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start Postgres
docker compose up -d

# 3. Install dependencies
npm i

# 4. Run database migrations
npx prisma migrate dev

# 5. Seed database with example strategy
npx prisma db seed

# 6. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Architecture

See [docs/SPEC.md](docs/SPEC.md) for the full MVP specification.

- **Data layer**: Prisma + PostgreSQL
- **API**: Next.js App Router route handlers
- **Core**: Graph validator, compiler, backtest engine in `src/lib/`
- **UI**: Minimal placeholder pages (React Flow canvas TBD)
