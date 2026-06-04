# Frontend

## Major React Components

| Component | Path | Purpose |
|-----------|------|---------|
| Strategies list | `app/strategies/page.tsx` | List strategies; **New Strategy** inline form → POST `/api/strategies` → redirect to workspace |
| StrategyWorkspace | `components/strategy/StrategyWorkspace.tsx` | Main layout, header, draft banner, backtest/paper tabs |
| StrategyCanvas | `components/strategy/StrategyCanvas.tsx` | React Flow canvas, autosave (1.5s debounce), node types |
| AiPromptPanel | `components/strategy/AiPromptPanel.tsx` | Textarea + Generate, validates response with Zod |
| BacktestPanel | `components/strategy/BacktestPanel.tsx` | Run backtest, poll run, TwoPaneChart, metrics, trades table |
| PaperTradingPanel | `components/strategy/PaperTradingPanel.tsx` | Start/Stop/Reset, poll session+trades, TwoPaneChart (streaming) |
| TwoPaneChart | `components/strategy/TwoPaneChart.tsx` | Top: candlestick or price line; bottom: equity. Markers, crosshair sync |
| StrategyChart | `components/strategy/StrategyChart.tsx` | Single-pane chart; used less than TwoPaneChart |
| EquityChart | `components/strategy/EquityChart.tsx` | Equity-only line chart |
| PaperEquityChart | `components/strategy/PaperEquityChart.tsx` | Equity chart with streaming append |
| nodeTypes/* | `components/strategy/nodeTypes/` | PriceNode, RsiNode, CompareNode, OpenPositionNode, etc. |

## Panel System

- **Left**: AiPromptPanel (fixed width ~320px)
- **Center**: StrategyCanvas (flex-1)
- **Bottom**: Tab bar (Backtest | Paper Trading); content switches per tab
- Draft banner appears above canvas when AI draft is ready; Apply/Cancel

## Chart Integration

- **Backtest**: `TwoPaneChart` with `bars`, `equity`, `trades`; mode=`backtest`. Bars from `/api/strategies/:id/bars` — real candles from TimescaleDB when available, synthetic fallback otherwise.
- **Paper**: `TwoPaneChart` with `streaming`, mode=`paper`. No bars initially; price line + equity streamed via `appendEquity` / `appendPrice` on poll. Markers updated from trades.
- **Lightweight Charts v5**: CandlestickSeries, LineSeries, createSeriesMarkers; crosshair sync between panes.

## Backtest Panel Behavior

1. Click "Run Backtest" → POST `/api/strategies/:id/backtests`
2. If response has `status=completed` → show metrics, chart, trades immediately
3. Else → poll GET `/api/backtests/:runId` every 1.5s until completed/failed
4. On complete: fetch trades, fetch bars (for candlestick), show TwoPaneChart
5. Equity curve from `run.log.equityCurve` or built from trades
6. Uses `runStrategyIdRef` / `runStrategyTimeframeRef` to avoid races when switching strategies

## Paper Trading Panel Behavior

1. Click "Start" → POST `/api/strategies/:id/paper/start`
2. Start polling: GET `/api/paper/:sessionId` (1s), GET `/api/paper/:sessionId/trades` (3s)
3. On each session poll: `appendFromSnapshot` streams equity/price to chart
4. On trades poll: `syncMarkersFromTrades` adds entry/exit markers
5. Stop → POST stop; Reset → POST reset, clears chart
6. Session state in React (`session`, `trades`); switching tabs unmounts panel, so session/trades refetched when returning (no explicit restore)

## State Management Patterns

- **Local useState** for panels (run, session, trades, metrics, etc.)
- **Refs** for mounted check, poll timers, strategyId/timeframe for race avoidance
- **No global store**; no Zustand/Redux
- Parent (StrategyWorkspace) passes `disableRun` when canvas is saving or draft is pending apply

## Polling Lifecycle

- **Backtest**: `POLL_INTERVAL_MS = 1500`; stops when run completed/failed
- **Paper**: Session 1s, trades 3s; stops when status !== "running"
- Cleanup in `useEffect` return: clearInterval, set `mountedRef = false` to avoid setState after unmount

## Known Frontend Bugs / Risks

- Switching tabs loses paper panel state; session exists in DB but UI starts fresh on return. No "resume session" UX.
- Backtest bars may be unavailable (`barsUnavailable`); chart shows equity only.
- Draft apply triggers save with `initialNodes/initialEdges`; depends on sync order of `setAppliedGraph` and canvas props.
- Chart streaming uses refs; if TwoPaneChart unmounts during poll, append calls no-op.
- No error boundary; unhandled errors can blank the page.
