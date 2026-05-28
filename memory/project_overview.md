---
name: project-overview
description: QuantBlocks — browser-based strategy builder, backtester, paper trader for perpetual futures; Phase 5 complete as of 2026-05-28
metadata:
  type: project
---

QuantBlocks is a full-stack Next.js 15 (App Router, TypeScript) application. All phases 1–5 are complete.

**Why:** MVP for a quant trading workspace: React Flow graph editor → backtest → paper trading against real market data.

**How to apply:** Use this as baseline context for any task on this project.

Key facts that aren't obvious from the code:
- TimescaleDB coexists with Prisma in the same PG instance — never run `prisma migrate dev` on a live DB (it will detect drift from the raw SQL hypertables)
- Strategy engine is shared between backtest and paper trading — never fork `lib/strategy/engine`
- `BacktestMetrics` interface in `metrics.ts` must be kept in sync with `BacktestPanel.tsx`, the backtest route, and the CSV export's `metricLabels` map
- Real-bar paper trading defaults `barCursor` to `session.startedAt − 90 days` (not epoch 0) when null
- Default `feeBps` is 5 (not 10) — 0.05% taker fee
- CoinGlass is optional — guard with `CoinGlassProvider.isConfigured()`; missing key → 503
