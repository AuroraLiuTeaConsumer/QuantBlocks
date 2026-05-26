/**
 * BacktestDataLoader — loads real historical candles from TimescaleDB
 * and converts them into the simple Candle shape that runBacktest() expects.
 *
 * On insufficient data it throws InsufficientDataError so the caller can
 * decide whether to fall back to SAMPLE_CANDLES or surface an error.
 */

import { getTimescaleRepo } from "../market-data/storage/timescale.repo";
import { TIMEFRAME_MS } from "../market-data/types";
import type { Exchange, Timeframe } from "../market-data/types";

// Candle shape consumed by runBacktest() — defined in backtest.ts.
// Importing the type here avoids a circular dep; the shape is simple enough
// to inline as an alias.
export interface BacktestInputCandle {
  time: string; // ISO 8601 UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Query / Result types ─────────────────────────────────────────────────────

export interface DataLoaderQuery {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
}

export interface DataLoaderResult {
  candles: BacktestInputCandle[];
  dataSource: "real";
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
  candleCount: number;
  coveragePct: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class InsufficientDataError extends Error {
  constructor(
    public readonly query: DataLoaderQuery,
    public readonly coveragePct: number,
    public readonly found: number,
    public readonly expected: number,
  ) {
    super(
      `Insufficient market data for ` +
        `${query.exchange} ${query.symbol} ${query.timeframe}: ` +
        `found ${found}/${expected} candles (${coveragePct.toFixed(1)}% coverage). ` +
        `Run the ingest job first:\n  npm run ingest`,
    );
    this.name = "InsufficientDataError";
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/** Minimum coverage (%) required before a backtest is allowed to proceed. */
const MIN_COVERAGE_PCT = 80;

export class BacktestDataLoader {
  /**
   * Load candles from TimescaleDB for the given query.
   *
   * Throws InsufficientDataError when coverage < MIN_COVERAGE_PCT.
   * The 80% threshold (vs 95% for live) accommodates exchange maintenance
   * windows and genuine data gaps on Binance.
   */
  async load(query: DataLoaderQuery): Promise<DataLoaderResult> {
    const repo = getTimescaleRepo();
    const { exchange, symbol, timeframe, startTime, endTime } = query;

    const candles = await repo.queryCandles({
      exchange,
      symbol,
      timeframe,
      startTime,
      endTime,
    });

    // Coverage: how many of the expected candles do we actually have?
    const tfMs = TIMEFRAME_MS[timeframe];
    const expectedCount = Math.max(
      0,
      Math.floor((endTime.getTime() - startTime.getTime()) / tfMs),
    );
    const coveragePct =
      expectedCount > 0 ? (candles.length / expectedCount) * 100 : 0;

    if (candles.length === 0 || coveragePct < MIN_COVERAGE_PCT) {
      throw new InsufficientDataError(
        query,
        coveragePct,
        candles.length,
        expectedCount,
      );
    }

    // Convert to the simple shape that runBacktest() consumes
    const backtestCandles: BacktestInputCandle[] = candles.map((c) => ({
      time: c.openTime.toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    return {
      candles: backtestCandles,
      dataSource: "real",
      exchange,
      symbol,
      timeframe,
      startTime,
      endTime,
      candleCount: backtestCandles.length,
      coveragePct,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _loader: BacktestDataLoader | undefined;

export function getBacktestDataLoader(): BacktestDataLoader {
  if (!_loader) _loader = new BacktestDataLoader();
  return _loader;
}
