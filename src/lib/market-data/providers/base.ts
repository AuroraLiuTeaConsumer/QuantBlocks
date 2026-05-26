import type { Candle, FundingRate, OpenInterest, Timeframe } from "../types";

/**
 * Common interface every market-data provider must implement.
 *
 * Phase 1: REST-only historical candle fetch.
 * Phase 2: funding rate and open interest historical fetch added.
 * Phase 3+: optional WebSocket subscription methods will be added here.
 */
export interface MarketDataProvider {
  /** Stable exchange identifier, e.g. 'binance'. */
  readonly exchangeId: string;

  /**
   * Fetch closed OHLCV candles.
   *
   * @param symbol    CCXT unified symbol, e.g. 'BTC/USDT:USDT'
   * @param timeframe e.g. '1h'
   * @param since     Return candles with open_time >= since
   * @param limit     Maximum candles to return (provider caps apply)
   */
  fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    since: Date,
    limit: number,
  ): Promise<Candle[]>;

  /**
   * Fetch historical funding rate events.
   *
   * @param symbol CCXT unified symbol
   * @param since  Return events with funding_time >= since
   * @param limit  Max events to return (exchange caps apply, typically 1 000)
   */
  fetchFundingRates(
    symbol: string,
    since: Date,
    limit: number,
  ): Promise<FundingRate[]>;

  /**
   * Fetch historical open interest snapshots.
   *
   * @param symbol    CCXT unified symbol
   * @param timeframe Snapshot granularity (e.g. '1h')
   * @param since     Return rows with ts >= since
   * @param limit     Max rows to return (exchange caps apply)
   */
  fetchOpenInterest(
    symbol: string,
    timeframe: Timeframe,
    since: Date,
    limit: number,
  ): Promise<OpenInterest[]>;
}
