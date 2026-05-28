import type { StrategyGraph } from "../strategy/graphTypes";
import {
  compileGraph,
  createInitialState,
  step,
  forceClose,
  type Bar,
  type TradeEvent,
} from "../strategy/engine";
import { computeMetrics } from "./metrics";
import type { BacktestMetrics } from "./metrics";
import { barFundingCost } from "./funding";
import type { FundingRate } from "../market-data/types";

// Re-export so callers that import BacktestMetrics from here still work.
export type { BacktestMetrics };

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
  feeBps: number;          // taker fee in basis points (e.g. 5 = 0.05%)
  slippageBps: number;     // 0 for MVP
  /** Funding rate events for the instrument. Applied per-bar when a position is open. */
  fundingRates?: FundingRate[];
  /** Duration of one candle in milliseconds — improves Sharpe/Sortino annualization. */
  timeframeMs?: number;
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
  let cumulativeFundingCost = 0;

  const reportEquity = () =>
    round(state.equity - cumulativeFees - cumulativeFundingCost);

  const hasFunding =
    Array.isArray(config.fundingRates) && config.fundingRates.length > 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const bar = candleToBar(candle);
    const result = step(compiled.value, bar, state);
    state = result.state;

    for (const evt of result.events) {
      processEvent(evt, i);
    }

    // Apply funding payments when a position is open
    if (hasFunding && state.position) {
      const barOpenMs = new Date(candle.time).getTime();
      const barCloseMs = barOpenMs + (config.timeframeMs ?? 3_600_000);
      cumulativeFundingCost += barFundingCost(
        config.fundingRates!,
        state.position,
        barOpenMs,
        barCloseMs,
        candle.close,
      );
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

  const metrics = computeMetrics(
    trades,
    config.initialCapital,
    equityCurve,
    candles,
    cumulativeFundingCost,
    config.timeframeMs,
  );
  return { metrics, equityCurve, trades, debugEvents };

  function processEvent(evt: TradeEvent, barIndex: number) {
    if (evt.kind === "OPENED") {
      const entryPrice = applySlippage(evt.entryPrice, evt.side, config.slippageBps);
      cumulativeFees += entryPrice * evt.qty * (config.feeBps / 10_000);
      const reasonOpen = `open_position(${evt.sourceNodeId})`;
      lastOpenReason = reasonOpen;
      trades.push({
        side: evt.side,
        entryTime: new Date(evt.timeSec * 1000).toISOString(),
        entryPrice,
        exitTime: null,
        exitPrice: null,
        qty: evt.qty,
        pnl: 0,
        reasonOpen,
        reasonClose: null,
      });
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
    const exitTime = new Date(evt.timeSec * 1000).toISOString();
    const reasonClose = mapCloseReason(evt);

    const openIdx = trades.findLastIndex((t) => t.exitPrice === null);
    if (openIdx >= 0) {
      trades[openIdx] = {
        ...trades[openIdx],
        exitTime,
        exitPrice,
        pnl: netPnl,
        reasonClose,
      };
    } else {
      trades.push({
        side: evt.side,
        entryTime: new Date(evt.entryTimeSec * 1000).toISOString(),
        entryPrice: evt.entryPrice,
        exitTime,
        exitPrice,
        qty: evt.qty,
        pnl: netPnl,
        reasonOpen: lastOpenReason || `open_position`,
        reasonClose,
      });
    }
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

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
