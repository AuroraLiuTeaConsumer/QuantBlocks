import type { BacktestMetrics } from "@/lib/backtest/metrics";
import { isTimeframe, TIMEFRAME_MS } from "@/lib/market-data/types";
import type { PerformanceAccumulator } from "@/lib/strategy/engine/types";

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function recordPaperBar(
  current: PerformanceAccumulator | undefined,
  initialEquity: number,
  previousEquity: number,
  equity: number,
  close: number,
  closedTradePnls: number[],
): PerformanceAccumulator {
  const next: PerformanceAccumulator = current
    ? { ...current, losingTrades: current.losingTrades ?? 0 }
    : {
        barCount: 0,
        returnSum: 0,
        returnSumSquares: 0,
        downsideSumSquares: 0,
        peakEquity: initialEquity,
        maxDrawdownPct: 0,
        firstClose: null,
        lastClose: null,
        closedTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        grossProfit: 0,
        grossLoss: 0,
      };

  const barReturn = initialEquity !== 0
    ? (equity - previousEquity) / initialEquity
    : 0;
  next.barCount += 1;
  next.returnSum += barReturn;
  next.returnSumSquares += barReturn ** 2;
  next.downsideSumSquares += Math.min(barReturn, 0) ** 2;
  next.peakEquity = Math.max(next.peakEquity, equity);
  const drawdownPct = next.peakEquity > 0
    ? ((next.peakEquity - equity) / next.peakEquity) * 100
    : 0;
  next.maxDrawdownPct = Math.max(next.maxDrawdownPct, drawdownPct);
  next.firstClose ??= close;
  next.lastClose = close;

  for (const pnl of closedTradePnls) {
    next.closedTrades += 1;
    if (pnl > 0) {
      next.winningTrades += 1;
      next.grossProfit += pnl;
    } else if (pnl < 0) {
      next.losingTrades += 1;
      next.grossLoss += Math.abs(pnl);
    }
  }
  return next;
}

export function recordPaperClose(
  current: PerformanceAccumulator | undefined,
  initialEquity: number,
  pnl: number,
): PerformanceAccumulator {
  const next = current ?? {
    barCount: 0,
    returnSum: 0,
    returnSumSquares: 0,
    downsideSumSquares: 0,
    peakEquity: initialEquity,
    maxDrawdownPct: 0,
    firstClose: null,
    lastClose: null,
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    grossProfit: 0,
    grossLoss: 0,
  };
  const copy = {
    ...next,
    losingTrades: next.losingTrades ?? 0,
    closedTrades: next.closedTrades + 1,
  };
  if (pnl > 0) {
    copy.winningTrades += 1;
    copy.grossProfit += pnl;
  } else if (pnl < 0) {
    copy.losingTrades += 1;
    copy.grossLoss += Math.abs(pnl);
  }
  return copy;
}

export function computePaperMetrics(
  performance: PerformanceAccumulator | undefined,
  initialEquity: number,
  finalEquity: number,
  timeframe: string,
): BacktestMetrics {
  const p = performance;
  const barCount = p?.barCount ?? 0;
  const returnSum = p?.returnSum ?? 0;
  const meanReturn = barCount > 0 ? returnSum / barCount : 0;
  const variance = barCount > 1
    ? Math.max(0, ((p?.returnSumSquares ?? 0) - (returnSum ** 2) / barCount) / (barCount - 1))
    : 0;
  const returnStd = Math.sqrt(variance);
  const downsideDev = barCount > 0
    ? Math.sqrt((p?.downsideSumSquares ?? 0) / barCount)
    : 0;
  const annFactor = isTimeframe(timeframe)
    ? (365 * 24 * 60 * 60 * 1_000) / TIMEFRAME_MS[timeframe]
    : 8_760;

  const netPnl = finalEquity - initialEquity;
  const totalReturnPct = initialEquity !== 0 ? (netPnl / initialEquity) * 100 : 0;
  const maxDrawdownPct = p?.maxDrawdownPct ?? 0;
  const annualizedReturnPct =
    barCount > 0 && totalReturnPct > -100
      ? (Math.pow(1 + totalReturnPct / 100, annFactor / barCount) - 1) * 100
      : totalReturnPct;
  const closedTrades = p?.closedTrades ?? 0;
  const wins = p?.winningTrades ?? 0;
  const grossProfit = p?.grossProfit ?? 0;
  const grossLoss = p?.grossLoss ?? 0;

  return {
    totalReturnPct: round4(totalReturnPct),
    netPnl: round4(netPnl),
    maxDrawdownPct: round4(maxDrawdownPct),
    winRate: round4(closedTrades > 0 ? wins / closedTrades : 0),
    numberOfTrades: closedTrades,
    avgWin: round4(wins > 0 ? grossProfit / wins : 0),
    avgLoss: round4(
      (p?.losingTrades ?? 0) > 0 ? -(grossLoss / (p?.losingTrades ?? 1)) : 0,
    ),
    profitFactor: grossLoss > 0
      ? round4(grossProfit / grossLoss)
      : grossProfit > 0 ? null : 0,
    sharpe: returnStd > 0
      ? round4((meanReturn / returnStd) * Math.sqrt(annFactor))
      : 0,
    sortino: downsideDev > 0
      ? round4((meanReturn / downsideDev) * Math.sqrt(annFactor))
      : 0,
    calmar: maxDrawdownPct > 0
      ? round4(annualizedReturnPct / maxDrawdownPct)
      : 0,
    benchmarkReturnPct:
      p?.firstClose != null && p.lastClose != null && p.firstClose > 0
        ? round4(((p.lastClose - p.firstClose) / p.firstClose) * 100)
        : 0,
    fundingCostPaid: 0,
  };
}
