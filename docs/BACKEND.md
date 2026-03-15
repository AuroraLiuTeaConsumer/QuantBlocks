# Backend

## Route Inventory

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create strategy |
| GET | `/api/strategies/[id]` | Get strategy |
| PUT | `/api/strategies/[id]` | Update strategy |
| DELETE | `/api/strategies/[id]` | Delete strategy |
| GET | `/api/strategies/[id]/bars` | **Stub** — synthetic OHLC bars |
| POST | `/api/strategies/[id]/backtests` | Start backtest (synchronous) |
| POST | `/api/strategies/[id]/paper/start` | Create/resume paper session |
| GET | `/api/backtests/[runId]` | Get backtest run |
| GET | `/api/backtests/[runId]/trades` | Get run trades |
| GET | `/api/paper/[sessionId]` | Poll session; advances engine if running |
| POST | `/api/paper/[sessionId]/stop` | Stop session |
| POST | `/api/paper/[sessionId]/reset` | Reset session to idle |
| GET | `/api/paper/[sessionId]/trades` | Get paper trades |
| POST | `/api/ai/translateStrategy` | **Stub** — returns RSI graph |

## API Shapes (Inferred from Code)

### POST `/api/strategies`

**Request**: `{ name, description?, timeframe?, nodes, edges }`  
**Response**: Strategy object (201)

### PUT `/api/strategies/[id]`

**Request**: `{ name?, description?, timeframe?, nodes?, edges? }`  
**Response**: Strategy object

### GET `/api/strategies/[id]/bars`

**Query**: `timeframe?`, `limit?`  
**Response**: `BarItem[]` — `{ time, open, high, low, close, volume? }` (synthetic)

### POST `/api/strategies/[id]/backtests`

**Request**: `{ initialCapital?, feeBps? }` (optional)  
**Response**: BacktestRun (201)

### POST `/api/strategies/[id]/paper/start`

**Request**: none  
**Response**: SessionSnapshot

### GET `/api/paper/[sessionId]`

**Response**: SessionSnapshot (advances session if status=running)

### POST `/api/ai/translateStrategy`

**Request**: `{ prompt, timeframe? }`  
**Response**: `{ strategyName, timeframe, nodes, edges, notes }`

## Prisma Models Involved

- `Strategy`: nodes, edges, instrument, timeframe
- `BacktestRun`: strategyId, status, metrics, log
- `Trade`: runId, side, entry/exit, qty, pnl, reasonOpen/Close
- `PaperSession`: strategyId, status, engineState, equity, position fields
- `PaperTrade`: sessionId, side, qty, entry/exit, pnl

## In-Memory / Singletons

- `lib/prisma.ts`: Global PrismaClient singleton (dev hot-reload safe)
- No other in-memory stores; paper session state lives in DB (`engineState` JSON)

## Backtest Flow

1. POST `/api/strategies/:id/backtests` → load strategy → validate graph → create BacktestRun (status=running)
2. `runBacktest(graph, SAMPLE_CANDLES, config)` — synchronous
3. Persist trades to `Trade`
4. Update run: status=completed, metrics, log (equityCurve, debugEvents)
5. Return run

## Paper Trading Flow

1. **Start**: POST `/api/strategies/:id/paper/start` → create PaperSession (status=running), `engineState` from `createInitialState`
2. **Poll**: GET `/api/paper/:sessionId` → if running: compute bars from elapsed time, `step` engine for each bar, persist trades, update session (optimistic lock)
3. **Stop**: POST `/api/paper/:sessionId/stop` → force-close position, set status=stopped
4. **Reset**: POST `/api/paper/:sessionId/reset` → delete trades, reset session to idle

## Known Backend Risks

- Bars are synthetic; backtest and chart show fake data.
- Paper execution only on poll; no real-time feed.
- Optimistic lock on paper session can fail under concurrent polls; no retry logic.
- Two engines (compiler vs engine) may produce different results for same graph.
- No rate limiting or auth on API routes.
