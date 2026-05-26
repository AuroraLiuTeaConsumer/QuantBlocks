import type { Candle, Timeframe } from "../types";

/**
 * Common interface every market-data provider must implement.
 *
 * Phase 1: REST-only historical fetch.
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
}
