import type { StrategyGraph } from "../strategy/graphTypes";
import {
  compileGraph,
  createInitialState,
  step,
  forceClose,
  type Bar,
  type TradeEvent,
} from "../strategy/engine";

// ---------------------------------------------------------------------------
// Candle type (OHLC series input for backtests)
// ---------------------------------------------------------------------------

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BacktestConfig {
  initialCapital: number;
  feeBps: number; // taker fee in basis points (e.g. 5 = 0.05%)
  slippageBps: number; // 0 for MVP
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 10_000,
  feeBps: 5,
  slippageBps: 0,
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TradeRecord {
  side: "long" | "short";
  entryTime: string;
  entryPrice: number;
  exitTime: string | null;
  exitPrice: number | null;
  qty: number;
  pnl: number;
  reasonOpen: string;
  reasonClose: string | null;
}

export interface EquityPoint {
  time: string;
  equity: number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  netPnl: number;
  maxDrawdownPct: number;
  winRate: number;
  numberOfTrades: number;
  avgWin: number;
  avgLoss: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  debugEvents: string[];
}

// ---------------------------------------------------------------------------
// Run backtest (shared strategy engine)
// ---------------------------------------------------------------------------

export function runBacktest(
  graph: StrategyGraph,
  candles: Candle[],
  config: BacktestConfig = DEFAULT_CONFIG,
): BacktestResult {
  const compiled = compileGraph(graph);
  if (!compiled.ok) {
    throw new Error(compiled.errors.map((e) => e.message).join("; "));
  }

  let state = createInitialState(config.initialCapital);
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const debugEvents: string[] = [];

  let lastOpenReason = "";
  let cumulativeFees = 0;

  const reportEquity = () => round(state.equity - cumulativeFees);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const bar = candleToBar(candle);
    const result = step(compiled.value, bar, state);
    state = result.state;

    for (const evt of result.events) {
      processEvent(evt, i);
    }

    equityCurve.push({ time: candle.time, equity: reportEquity() });
  }

  if (state.position && candles.length > 0) {
    const lastBar = candleToBar(candles[candles.length - 1]);
    const { state: closed, event } = forceClose(state, lastBar);
    state = closed;
    if (event) processEvent(event, candles.length - 1);
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        time: candles[candles.length - 1].time,
        equity: reportEquity(),
      };
    }
  }

  const metrics = computeMetrics(trades, config.initialCapital, equityCurve);
  return { metrics, equityCurve, trades, debugEvents };

  function processEvent(evt: TradeEvent, barIndex: number) {
    if (evt.kind === "OPENED") {
      const entryPrice = applySlippage(evt.entryPrice, evt.side, config.slippageBps);
      cumulativeFees += entryPrice * evt.qty * (config.feeBps / 10_000);
      lastOpenReason = `open_position(${evt.sourceNodeId})`;
      debugEvents.push(`[bar ${barIndex}] Opened ${evt.side} @ ${entryPrice}`);
      return;
    }

    const exitPrice = applySlippage(
      evt.exitPrice,
      evt.side === "long" ? "short" : "long",
      config.slippageBps,
    );
    const exitFee = exitPrice * evt.qty * (config.feeBps / 10_000);
    cumulativeFees += exitFee;
    const netPnl = round(evt.pnl - exitFee);

    trades.push({
      side: evt.side,
      entryTime: new Date(evt.entryTimeSec * 1000).toISOString(),
      entryPrice: evt.entryPrice,
      exitTime: new Date(evt.timeSec * 1000).toISOString(),
      exitPrice,
      qty: evt.qty,
      pnl: netPnl,
      reasonOpen: lastOpenReason || `open_position`,
      reasonClose: mapCloseReason(evt),
    });
    debugEvents.push(
      `[bar ${barIndex}] Closed ${evt.side} @ ${exitPrice} (${evt.reason}) pnl=${netPnl}`,
    );
    lastOpenReason = "";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candleToBar(candle: Candle): Bar {
  return {
    timeSec: Math.floor(new Date(candle.time).getTime() / 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function mapCloseReason(evt: Extract<TradeEvent, { kind: "CLOSED" }>): string {
  switch (evt.reason) {
    case "stopLoss":
      return "SL hit";
    case "takeProfit":
      return "TP hit";
    case "endOfRun":
      return "end_of_backtest";
    case "signal":
      return evt.sourceNodeId
        ? `close_position(${evt.sourceNodeId})`
        : "signal";
    default:
      return evt.reason;
  }
}

function applySlippage(price: number, side: string, slippageBps: number): number {
  const slip = price * (slippageBps / 10_000);
  return side === "long" ? price + slip : price - slip;
}

function computeMetrics(
  trades: TradeRecord[],
  initialCapital: number,
  equityCurve: EquityPoint[],
): BacktestMetrics {
  const closedTrades = trades.filter((t) => t.exitPrice !== null);
  const wins = closedTrades.filter((t) => t.pnl > 0);
  const losses = closedTrades.filter((t) => t.pnl <= 0);

  const netPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalReturnPct = (netPnl / initialCapital) * 100;
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  let peak = initialCapital;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? (peak - pt.equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalReturnPct: round(totalReturnPct),
    netPnl: round(netPnl),
    maxDrawdownPct: round(maxDD * 100),
    winRate: round(winRate),
    numberOfTrades: closedTrades.length,
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
