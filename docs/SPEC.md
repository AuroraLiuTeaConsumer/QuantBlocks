# QuantBlocks — MVP SPEC (v0.1)

## 0. One-liner
QuantBlocks is a strategy building + backtesting + (paper) execution workspace for Hyperliquid-style perpetual trading:
**Talk to build, visualize to verify.**

## 1. Goals (MVP)
MVP must deliver a closed loop:
1) User describes a strategy in natural language
2) AI translates it into a **React Flow** strategy graph (nodes/edges)
3) User can view/edit the graph
4) System can backtest the graph on historical candles
5) System can run the same graph in **paper trading** mode on live-ish candles

## 2. Non-goals (MVP)
- No real-money trading (no signing orders, no private key custody)
- No user auth / teams / sharing
- No strategy marketplace
- No multi-exchange support
- No complex order types (no limit, OCO, trailing stop)
- No portfolio / multi-asset allocation
- No advanced indicators beyond the MVP list

## 3. Scope Constraints (Hard)
- Market: **BTC-PERP only** (single instrument)
- Timeframes: start with **1m / 5m / 1h** (configurable)
- Indicators available: **Price, Volume, RSI**
- Execution types: **Market Open**, **Market Close**, **Set SL/TP (simple)**

## 4. MVP User Stories
1) As a user, I can create a strategy and save it.
2) As a user, I can generate a strategy graph from a natural-language prompt.
3) As a user, I can run a backtest and see summary metrics + trade list.
4) As a user, I can paper-run the strategy and see simulated trades update.
5) As a user, I can edit node parameters (e.g., RSI period/threshold) and re-run backtest.

## 5. System Overview
### Components
- **Builder** (React Flow canvas): author strategy graph (nodes/edges)
- **Validator** (server): validates graph schema + semantic checks
- **Interpreter** (server): compiles graph -> executable rule plan
- **Backtest Engine** (server): runs rule plan over historical candles
- **Paper Executor** (server): runs rule plan on streaming candles; simulates fills
- **AI Translator** (server): natural language -> graph JSON (nodes/edges)

### Single Source of Truth
- Strategy is stored as **React Flow `nodes[]` + `edges[]`**.
- Backtest/execution **must** consume the same stored graph (no “chat-only” logic).

## 6. Data Model (Logical)
### Entities
- Strategy
- BacktestRun
- Trade (from backtest or paper run)
- PaperRun (optional separate entity; can reuse BacktestRun with mode)

### Strategy (logical fields)
- id (uuid)
- name (string)
- description (string, optional)
- instrument (string; fixed "BTC-PERP")
- timeframe (string; e.g. "1m" | "5m" | "1h")
- nodes (json)  // React Flow nodes[]
- edges (json)  // React Flow edges[]
- createdAt, updatedAt

### BacktestRun
- id (uuid)
- strategyId (fk)
- mode ("backtest" | "paper")
- status ("queued" | "running" | "completed" | "failed")
- startTime (ISO)
- endTime (ISO)
- metrics (json) // PnL, maxDD, winrate, trades, etc.
- log (json, optional) // debug events
- createdAt

### Trade
- id (uuid)
- runId (fk BacktestRun)
- side ("long" | "short")
- entryTime, entryPrice
- exitTime, exitPrice (nullable if open in paper)
- qty (number)
- pnl (number)
- reasonOpen (string/json)
- reasonClose (string/json)

> Note: In Prisma, `nodes` and `edges` are stored as JSON columns.

## 7. Strategy Graph Spec (React Flow)
### 7.1 Node Shape (MVP)
Each node follows React Flow format:
- id: string
- type: string  // one of defined node types
- position: { x: number, y: number }
- data: object  // typed by node type

Edges follow React Flow:
- id: string
- source: string
- target: string
- sourceHandle?: string
- targetHandle?: string
- type?: string (optional)

### 7.2 Node Types (MVP)
We model a simple **signal graph**:
- Data nodes produce series/values
- Condition nodes produce boolean signals
- Action nodes produce trade actions
- Control nodes combine boolean signals

#### Data Nodes
1) `price`
- data: { field: "close" | "open" | "high" | "low" } // default "close"

2) `volume`
- data: { }

3) `rsi`
- data: { period: number } // default 14

#### Logic / Condition Nodes
4) `compare`
- data: { op: ">" | "<" | ">=" | "<=" | "==" , rightType: "number" | "series", rightValue?: number }
- Inputs:
  - left: series/value (from price/volume/rsi)
  - right: optional series/value if rightType="series"
- Output: boolean

5) `cross`
- data: { direction: "crossUp" | "crossDown" }
- Inputs: a (series), b (series or constant)
- Output: boolean
> MVP simplification: allow b as constant by using a `constant` node or rightValue.

6) `and`
- data: { }
- Inputs: boolean[], Output: boolean

7) `or`
- data: { }
- Inputs: boolean[], Output: boolean

8) `not`
- data: { }
- Input: boolean, Output: boolean

#### Utility Nodes
9) `constant`
- data: { value: number }

#### Action Nodes
10) `open_position`
- data: { side: "long" | "short", qtyType: "fixed", qty: number }
- Input: trigger boolean
- Behavior: when trigger becomes true (edge-triggered), open if flat.

11) `close_position`
- data: { }  // close all
- Input: trigger boolean
- Behavior: when trigger becomes true, close if in position.

12) `set_risk`
- data: { slPct?: number, tpPct?: number }
- Input: optional trigger boolean (or always-on)
- Behavior: attaches SL/TP to current/open position in backtest/paper simulation.

### 7.3 Graph Semantics (Hard Rules)
- Graph must contain:
  - At least one `open_position`
  - At least one `close_position` OR a `set_risk` with TP/SL
- Only **one open position at a time** (no pyramiding in MVP).
- If both long and short open triggers fire on same bar:
  - Priority: do nothing (safe default) OR choose first by deterministic rule.
  - MVP rule: **ignore both and log conflict**.
- Entry/exit evaluation is **bar-by-bar**:
  - Conditions are computed on each bar close (MVP).
  - Triggers are edge-triggered: fire when condition transitions `false -> true`.

### 7.4 Valid Connection Patterns
- Data nodes connect to compare/cross inputs.
- Logic nodes connect to other logic nodes inputs.
- Logic nodes connect to action nodes trigger input.
- No cycles (DAG only) in MVP.
- Validator must reject cycles.

## 8. Backtest Engine Spec (MVP)
### 8.1 Inputs
- strategy graph (nodes/edges)
- candle series: [{ time, open, high, low, close, volume }]
- initial capital: default 10,000 (USD)
- fee model: simple taker fee (configurable constant)
- slippage: constant bps or 0 (MVP can be 0)

### 8.2 Execution Model
- Market orders filled at **next bar open** (or current bar close) — choose one and be consistent.
- MVP default: **fill at next bar open**.
- SL/TP:
  - If SL/TP set, check intrabar:
    - If low <= SL for long (or high >= SL for short), stop triggers.
    - If high >= TP for long (or low <= TP for short), take-profit triggers.
  - If both SL and TP hit in same bar:
    - MVP rule: **assume worst-case** (SL first) OR deterministic ordering.
    - MVP default: **worst-case** (more conservative).

### 8.3 Outputs
- metrics:
  - totalReturnPct
  - netPnl
  - maxDrawdownPct
  - winRate
  - numberOfTrades
  - avgWin, avgLoss
- equityCurve: array of { time, equity }
- trades: list of Trade records
- debugEvents (optional): condition fires, conflicts, etc.

## 9. Paper Trading Spec (MVP)
- Uses the same compiled rule plan as backtest.
- Candle source: mocked streaming (polling) or websocket (implementation detail).
- Paper fills use same model as backtest (next bar open).
- Stores trades under BacktestRun with mode="paper".
- UI shows:
  - current position state
  - last signal reason
  - trade list updating

## 10. AI Translator Contract (MVP)
### Input
- natural language prompt (string)
- optional: timeframe preference

### Output (strict JSON)
- strategyName (string)
- timeframe (string; must be one of allowed)
- nodes (React Flow nodes[])
- edges (React Flow edges[])
- notes (string; explanation)

### Requirements
- Must only use allowed node types.
- Must connect graph so it validates.
- Must include conservative defaults:
  - RSI period 14
  - qty fixed small (e.g., 0.01 BTC) if unspecified
- Must avoid ambiguous terms:
  - If user says “breakout”, interpret as close > level (compare with constant)
  - If user says “retest”, interpret as cross + compare combo or omit with notes.

> The app must run server-side validation. If invalid, return errors and ask AI to repair.

## 11. API Surface (MVP)
### Strategies
- POST /api/strategies  (`name` required; `nodes`/`edges` optional — blank canvas OK)
- GET /api/strategies
- GET /api/strategies/:id
- PUT /api/strategies/:id  (updates nodes/edges/name/desc; no graph validation on save)
- DELETE /api/strategies/:id

> `validateGraph()` runs on backtest start and AI translate, not on POST/PUT save.

### Backtests
- POST /api/strategies/:id/backtests  (start)
- GET /api/backtests/:runId
- GET /api/backtests/:runId/trades

### AI
- POST /api/ai/translateStrategy  (prompt -> graph JSON)

### Paper
- POST /api/strategies/:id/paper/start
- POST /api/strategies/:id/paper/stop
- GET /api/paper/:runId/state

## 12. UI Pages (MVP)
- /strategies
  - list + create
- /strategies/[id]
  - left: AI chat input (generate graph)
  - center/right: React Flow canvas (view/edit)
  - bottom: backtest panel (run + results)
- /backtests/[runId] (optional)
  - detailed results

## 13. Milestones
M1: CRUD Strategies + save/load nodes/edges
M2: Validator + Interpreter (graph -> executable plan)
M3: Backtest engine + results UI
M4: AI translate prompt -> graph + auto-import
M5: Paper trading loop (simulated streaming) + state UI

## 14. Testing (MVP)
- Unit tests:
  - graph validation (cycle detection, required nodes)
  - interpreter correctness on small synthetic graphs
  - backtest engine determinism on fixed candles
- Snapshot tests for AI output schema (validate JSON)

## 15. Security & Safety (MVP)
- No private keys
- If later supporting API keys, store encrypted + never log
- Rate limit AI endpoint
- Always run validation before backtest/paper
