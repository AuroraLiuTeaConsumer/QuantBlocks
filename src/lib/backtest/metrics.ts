/**
 * BacktestMetrics and computeMetrics — extracted from backtest.ts so the
 * simulation loop stays focused on execution, not analytics.
 *
 * Phase 5 additions: Sharpe, Sortino, Calmar, benchmark return, funding cost.
 */

import type { TradeRecord, EquityPoint, Candle } from "./backtest";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestMetrics {
  // ── Core ──────────────────────────────────────────────────────────────────
  totalReturnPct: number;
  netPnl: number;
  maxDrawdownPct: number;
  winRate: number;
  numberOfTrades: number;
  avgWin: number;
  avgLoss: number;
  /** null when there are no losing trades (profit factor is unbounded). */
  profitFactor: number | null;
  // ── Risk-adjusted (Phase 5) ───────────────────────────────────────────────
  /** Annualized Sharpe ratio (risk-free rate = 0). */
  sharpe: number;
  /** Annualized Sortino ratio (uses downside deviation only). */
  sortino: number;
  /** Calmar ratio: annualized return / max drawdown. 0 when drawdown is 0. */
  calmar: number;
  /** Buy-and-hold return over the same candle window. */
  benchmarkReturnPct: number;
  /** Total USD paid in funding fees (positive = paid, negative = received). 0 when no rates loaded. */
  fundingCostPaid: number;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Derive annualization factor (bars per year) from the equity curve spacing
 * or a caller-supplied timeframe hint.
 */
function annualizationFactor(
  equityCurve: EquityPoint[],
  timeframeMsHint?: number,
): number {
  const msPerYear = 365 * 24 * 60 * 60 * 1_000;
  if (timeframeMsHint && timeframeMsHint > 0) return msPerYear / timeframeMsHint;
  if (equityCurve.length >= 2) {
    const t0 = new Date(equityCurve[0].time).getTime();
    const t1 = new Date(equityCurve[1].time).getTime();
    const diff = t1 - t0;
    if (diff > 0) return msPerYear / diff;
  }
  return 8_760; // default: hourly
}

function sampleStd(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Compute all backtest metrics from simulation outputs.
 *
 * @param trades          Closed + still-open trade records.
 * @param initialCapital  Starting equity.
 * @param equityCurve     Per-bar equity snapshots (one per candle).
 * @param candles         The raw candle series (used for benchmark return).
 * @param fundingCostPaid Cumulative funding fees applied during simulation.
 * @param timeframeMsHint Duration of one bar in ms (improves annualization).
 */
export function computeMetrics(
  trades: TradeRecord[],
  initialCapital: number,
  equityCurve: EquityPoint[],
  candles: Candle[],
  fundingCostPaid: number,
  timeframeMsHint?: number,
): BacktestMetrics {
  const closedTrades = trades.filter((t) => t.exitPrice !== null);
  const wins = closedTrades.filter((t) => t.pnl > 0);
  const losses = closedTrades.filter((t) => t.pnl < 0);

  // The equity curve is the accounting source of truth: unlike the individual
  // trade records, it includes entry fees, exit fees, funding, and any open
  // position mark-to-market at the final bar.
  const closedTradePnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital + closedTradePnl;
  const netPnl = finalEquity - initialCapital;
  const totalReturnPct = (netPnl / initialCapital) * 100;
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  // null = no losing trades (unbounded); 0 = no winning trades or no closed trades
  const profitFactor: number | null =
    grossLoss > 0 ? round4(grossProfit / grossLoss) : grossProfit > 0 ? null : 0;

  // ── Max drawdown ────────────────────────────────────────────────────────
  let peak = initialCapital;
  let maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? (peak - pt.equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDDPct = maxDD * 100;

  // ── Annualization ────────────────────────────────────────────────────────
  const annFactor = annualizationFactor(equityCurve, timeframeMsHint);

  // ── Per-bar returns ──────────────────────────────────────────────────────
  const barReturns: number[] = [];
  let previousEquity = initialCapital;
  for (const point of equityCurve) {
    // Normalize P&L changes by stable starting capital. Dividing by previous
    // equity becomes undefined at insolvency and creates enormous sign-flipping
    // returns near zero; it also caused the old implementation to omit bars
    // whenever equity was non-positive. Capital-normalized strategy returns are
    // defined across the full run and telescope to the reported total return.
    barReturns.push((point.equity - previousEquity) / initialCapital);
    previousEquity = point.equity;
  }
  const meanReturn =
    barReturns.length > 0 ? barReturns.reduce((s, r) => s + r, 0) / barReturns.length : 0;

  // ── Sharpe ──────────────────────────────────────────────────────────────
  const returnStd = sampleStd(barReturns);
  const sharpe =
    returnStd > 0 ? round4((meanReturn / returnStd) * Math.sqrt(annFactor)) : 0;

  // ── Sortino ─────────────────────────────────────────────────────────────
  // Downside semideviation around a 0% target, measured across all periods.
  // This remains defined when a run has only one losing period.
  const downsideVariance =
    barReturns.length > 0
      ? barReturns.reduce((sum, r) => sum + Math.min(r, 0) ** 2, 0) / barReturns.length
      : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortino =
    downsideDev > 0 ? round4((meanReturn / downsideDev) * Math.sqrt(annFactor)) : 0;

  // ── Calmar ──────────────────────────────────────────────────────────────
  // Annualized return: compound the total return over (barCount / barsPerYear) years
  const barCount = equityCurve.length;
  const annualizedReturnPct =
    barCount > 0 && totalReturnPct > -100
      ? (Math.pow(1 + totalReturnPct / 100, annFactor / barCount) - 1) * 100
      : totalReturnPct;
  const calmar = maxDDPct > 0 ? round4(annualizedReturnPct / maxDDPct) : 0;

  // ── Benchmark (buy-and-hold) ─────────────────────────────────────────────
  let benchmarkReturnPct = 0;
  if (candles.length >= 2) {
    const firstClose = candles[0].close;
    const lastClose = candles[candles.length - 1].close;
    if (firstClose > 0) {
      benchmarkReturnPct = round4(((lastClose - firstClose) / firstClose) * 100);
    }
  }

  return {
    totalReturnPct: round4(totalReturnPct),
    netPnl: round4(netPnl),
    maxDrawdownPct: round4(maxDDPct),
    winRate: round4(winRate),
    numberOfTrades: closedTrades.length,
    avgWin: round4(avgWin),
    avgLoss: round4(avgLoss),
    profitFactor,
    sharpe,
    sortino,
    calmar,
    benchmarkReturnPct,
    fundingCostPaid: round4(fundingCostPaid),
  };
}
