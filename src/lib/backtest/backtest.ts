import type { StrategyGraph } from "../strategy/graphTypes";
import {
  compilePlan,
  createInitialState,
  evaluateBar,
  type Candle,
  type BarAction,
} from "../strategy/compiler";

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
// Internal position state
// ---------------------------------------------------------------------------

interface Position {
  side: "long" | "short";
  entryPrice: number;
  entryTime: string;
  qty: number;
  slPrice: number | null;
  tpPrice: number | null;
  reasonOpen: string;
}

interface PendingOrder {
  type: "open" | "close";
  side?: "long" | "short";
  qty?: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Run backtest
// ---------------------------------------------------------------------------

export function runBacktest(
  graph: StrategyGraph,
  candles: Candle[],
  config: BacktestConfig = DEFAULT_CONFIG,
): BacktestResult {
  const plan = compilePlan(graph);
  const evalState = createInitialState();

  let capital = config.initialCapital;
  let position: Position | null = null;
  let pendingOrder: PendingOrder | null = null;

  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const debugEvents: string[] = [];

  let peakEquity = capital;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // Step 1: Fill pending orders at this bar's open
    if (pendingOrder && i > 0) {
      const fillPrice = applySlippage(candle.open, pendingOrder.side ?? "long", config.slippageBps);

      if (pendingOrder.type === "open" && !position) {
        const qty = pendingOrder.qty ?? 0.01;
        const fee = fillPrice * qty * (config.feeBps / 10_000);
        capital -= fee;
        position = {
          side: pendingOrder.side!,
          entryPrice: fillPrice,
          entryTime: candle.time,
          qty,
          slPrice: null,
          tpPrice: null,
          reasonOpen: pendingOrder.reason,
        };
        debugEvents.push(`[bar ${i}] Opened ${position.side} @ ${fillPrice}`);
      } else if (pendingOrder.type === "close" && position) {
        closePosition(position, fillPrice, candle.time, pendingOrder.reason);
      }
      pendingOrder = null;
    }

    // Step 2: Check SL/TP intra-bar
    if (position) {
      const slHit = checkSL(position, candle);
      const tpHit = checkTP(position, candle);

      if (slHit && tpHit) {
        // Worst case: SL first (SPEC §8.2)
        closePosition(position, position.slPrice!, candle.time, "SL hit (worst-case)");
        debugEvents.push(`[bar ${i}] SL+TP conflict, closed at SL (worst-case)`);
      } else if (slHit) {
        closePosition(position, position.slPrice!, candle.time, "SL hit");
        debugEvents.push(`[bar ${i}] SL hit @ ${position.slPrice}`);
      } else if (tpHit) {
        closePosition(position, position.tpPrice!, candle.time, "TP hit");
        debugEvents.push(`[bar ${i}] TP hit @ ${position.tpPrice}`);
      }
    }

    // Step 3: Evaluate plan
    const actions = evaluateBar(plan, evalState, candles, i);

    // Step 4: Process actions → queue for next bar
    let openAction: BarAction | null = null;
    let closeAction: BarAction | null = null;
    let riskAction: BarAction | null = null;

    for (const a of actions) {
      if (a.type === "open_position") openAction = a;
      else if (a.type === "close_position") closeAction = a;
      else if (a.type === "set_risk") riskAction = a;
    }

    // Conflict: both long and short open → do nothing (SPEC §7.3)
    if (openAction && closeAction) {
      // Open and close at the same bar: prioritize close if in position, else open
      if (position) {
        pendingOrder = { type: "close", reason: `close_position(${closeAction.nodeId})` };
      } else {
        pendingOrder = {
          type: "open",
          side: openAction.side,
          qty: openAction.qty,
          reason: `open_position(${openAction.nodeId})`,
        };
      }
    } else if (closeAction && position) {
      pendingOrder = { type: "close", reason: `close_position(${closeAction.nodeId})` };
    } else if (openAction && !position) {
      pendingOrder = {
        type: "open",
        side: openAction.side,
        qty: openAction.qty,
        reason: `open_position(${openAction.nodeId})`,
      };
    }

    // Apply set_risk to current position
    if (riskAction && riskAction.type === "set_risk" && position) {
      if (riskAction.slPct != null) {
        position.slPrice =
          position.side === "long"
            ? position.entryPrice * (1 - riskAction.slPct / 100)
            : position.entryPrice * (1 + riskAction.slPct / 100);
      }
      if (riskAction.tpPct != null) {
        position.tpPrice =
          position.side === "long"
            ? position.entryPrice * (1 + riskAction.tpPct / 100)
            : position.entryPrice * (1 - riskAction.tpPct / 100);
      }
    }

    // Equity snapshot at bar close
    const unrealized = position ? unrealizedPnl(position, candle.close) : 0;
    const equity = capital + unrealized;
    equityCurve.push({ time: candle.time, equity });
    if (equity > peakEquity) peakEquity = equity;
  }

  // Close any open position at last bar close
  if (position) {
    const lastCandle = candles[candles.length - 1];
    closePosition(position, lastCandle.close, lastCandle.time, "end_of_backtest");
  }

  // Compute metrics
  const metrics = computeMetrics(trades, config.initialCapital, equityCurve);

  return { metrics, equityCurve, trades, debugEvents };

  // --- Closure helpers ---

  function closePosition(pos: Position, exitPrice: number, exitTime: string, reason: string) {
    const fee = exitPrice * pos.qty * (config.feeBps / 10_000);
    const raw =
      pos.side === "long"
        ? (exitPrice - pos.entryPrice) * pos.qty
        : (pos.entryPrice - exitPrice) * pos.qty;
    const pnl = raw - fee;
    capital += raw - fee;

    trades.push({
      side: pos.side,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime,
      exitPrice,
      qty: pos.qty,
      pnl,
      reasonOpen: pos.reasonOpen,
      reasonClose: reason,
    });
    position = null;
  }
}

// ---------------------------------------------------------------------------
// SL / TP checks
// ---------------------------------------------------------------------------

function checkSL(pos: Position, candle: Candle): boolean {
  if (pos.slPrice === null) return false;
  if (pos.side === "long") return candle.low <= pos.slPrice;
  return candle.high >= pos.slPrice;
}

function checkTP(pos: Position, candle: Candle): boolean {
  if (pos.tpPrice === null) return false;
  if (pos.side === "long") return candle.high >= pos.tpPrice;
  return candle.low <= pos.tpPrice;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unrealizedPnl(pos: Position, currentPrice: number): number {
  return pos.side === "long"
    ? (currentPrice - pos.entryPrice) * pos.qty
    : (pos.entryPrice - currentPrice) * pos.qty;
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

  // Max drawdown
  let peak = initialCapital;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = (peak - pt.equity) / peak;
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
