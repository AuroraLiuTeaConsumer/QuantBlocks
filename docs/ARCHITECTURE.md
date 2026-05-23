# Architecture

## Overview

QuantBlocks is a full-stack Next.js application. Frontend and API routes run in the same process. No background workers; paper trading advances via polling.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ StrategyCanvas│  │ BacktestPanel │  │ PaperTradingPanel    │   │
│  │ (React Flow)  │  │ (poll run)    │  │ (poll session+trades)│   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
└─────────┼─────────────────┼──────────────────────┼───────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js (App Router)                                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ API Routes: /api/strategies, /api/backtests, /api/paper,     ││
│  │             /api/ai/translateStrategy, /api/strategies/:id/  ││
│  │             bars, backtests, paper/start                     ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ lib/strategy │ │ lib/backtest │ │ lib/paper/engine         │ │
│  │ validator    │ │ backtest.ts  │ │ (toSnapshot, types)      │ │
│  │ graphTypes   │ │ (SAMPLE_CANDL│ │ lib/strategy/engine/     │ │
│  │              │ │ ES)          │ │ (compile, step, runtime) │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Prisma → PostgreSQL                                            │
│  Strategy, BacktestRun, Trade, PaperSession, PaperTrade          │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| StrategyWorkspace | `components/strategy/StrategyWorkspace.tsx` | Layout, tabs, apply/cancel draft |
| StrategyCanvas | `components/strategy/StrategyCanvas.tsx` | React Flow graph, autosave, node types |
| AiPromptPanel | `components/strategy/AiPromptPanel.tsx` | AI prompt UI, calls translateStrategy |
| BacktestPanel | `components/strategy/BacktestPanel.tsx` | Run backtest, poll run, metrics, chart, trades |
| PaperTradingPanel | `components/strategy/PaperTradingPanel.tsx` | Start/stop/reset, poll session+trades, chart |
| TwoPaneChart | `components/strategy/TwoPaneChart.tsx` | Candlestick/line + equity, markers, streaming |
| StrategyChart | `components/strategy/StrategyChart.tsx` | Legacy single-pane chart; less used |
| nodeTypes | `components/strategy/nodeTypes/` | React Flow node components per graph type |

## Backend / API Modules

| Layer | Path | Responsibility |
|-------|------|----------------|
| Strategies API | `app/api/strategies/route.ts`, `[id]/route.ts` | CRUD strategies |
| Bars API | `app/api/strategies/[id]/bars/route.ts` | **Stub**: synthetic random-walk bars |
| Backtests API | `app/api/strategies/[id]/backtests/route.ts` | POST creates run, runs synchronously |
| Backtest run | `app/api/backtests/[runId]/route.ts`, `trades/route.ts` | GET run, GET trades |
| Paper start | `app/api/strategies/[id]/paper/start/route.ts` | Create/resume session |
| Paper poll | `app/api/paper/[sessionId]/route.ts` | GET advances session (simulated bars, step engine) |
| Paper stop/reset | `app/api/paper/[sessionId]/stop`, `reset/route.ts` | Stop session, reset to idle |
| Paper trades | `app/api/paper/[sessionId]/trades/route.ts` | GET trades |
| AI translate | `app/api/ai/translateStrategy/route.ts` | **Stub**: always returns RSI graph |

## Persistence Model

- **Strategy**: nodes, edges (JSON); instrument, timeframe, metadata.
- **BacktestRun**: status, metrics, log (equityCurve, debugEvents).
- **Trade**: runId, side, entry/exit, qty, pnl, reasonOpen/Close.
- **PaperSession**: status, engineState (JSON), equity, position, lastPrice.
- **PaperTrade**: sessionId, side, qty, entry/exit, pnl.

## Strategy Graph Flow

1. **Save**: StrategyCanvas → PUT `/api/strategies/:id` → `validateGraph` → Prisma update.
2. **Backtest**: BacktestPanel → POST `/api/strategies/:id/backtests` → `runBacktest` (shared engine) → SAMPLE_CANDLES → trades persisted.
3. **Paper**: PaperTradingPanel → POST `/api/strategies/:id/paper/start` → PaperSession created; GET `/api/paper/:sessionId` advances engine with simulated bars per poll.

## Polling-Based Execution Model

- **Backtest**: Synchronous; no polling needed. Run completes before response.
- **Paper trading**: Execution happens on GET `/api/paper/:sessionId`. Elapsed time since `updatedAt` drives how many simulated bars to step. No background worker; client polls every 1s (session) and 3s (trades).

## Separation of Concerns

| Concern | Location |
|---------|----------|
| UI | `components/strategy/*` |
| Route handlers | `app/api/*` |
| Engine logic | `lib/strategy/engine/*`, `lib/backtest/backtest.ts` (fees/metrics wrapper) |
| Validation | `lib/strategy/validator.ts`, `lib/strategy/graphTypes.ts` (Zod) |
| DB access | `lib/prisma.ts`, Prisma models |

## Current Weak Points / Technical Debt

1. **Synthetic data everywhere**: Bars, backtest candles, paper bars — all fake.
3. **No background worker**: Paper advances only when a client polls. Multiple tabs could cause duplicate advancement; optimistic lock mitigates but is imperfect.
4. **Session persistence**: Switching tabs (backtest ↔ paper) does not preserve paper session state in UI; session lives in DB but panel state resets.
5. **AI stub**: No real LLM; always same RSI strategy.
6. **Strategy creation UX**: Strategies created via API; no "New Strategy" UI.
