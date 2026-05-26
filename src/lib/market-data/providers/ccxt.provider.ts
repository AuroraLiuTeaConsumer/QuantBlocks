/**
 * CCXTProvider — wraps the CCXT unified API for historical OHLCV fetching.
 *
 * Phase 1: Binance USDT-margined perpetuals only.
 * Phase 2+: add Bybit, OKX by instantiating this class with a different Exchange.
 *
 * IMPORTANT: 'ccxt' must be listed in next.config.ts serverExternalPackages
 * so Next.js does not attempt to bundle it. CCXT uses dynamic require() calls
 * and native bindings that are incompatible with webpack bundling.
 */

import type { Exchange as ExchangeId, Timeframe, Candle } from "../types";
import { TIMEFRAME_MS } from "../types";
import type { MarketDataProvider } from "./base";

// ─── Exchange constructor config ──────────────────────────────────────────────

interface ExchangeConfig {
  ccxtId: string; // CCXT exchange class name
  options: Record<string, unknown>; // forwarded to the CCXT constructor
}

const EXCHANGE_CONFIGS: Record<ExchangeId, ExchangeConfig> = {
  binance: {
    ccxtId: "binance",
    options: {
      // 'future' = USDT-margined perpetuals & futures on Binance
      defaultType: "future",
    },
  },
  bybit: {
    ccxtId: "bybit",
    options: { defaultType: "swap" },
  },
  okx: {
    ccxtId: "okx",
    options: { defaultType: "swap" },
  },
  hyperliquid: {
    // Phase 3: replaced by NativeHyperliquidProvider.
    // Listed here so the registry doesn't crash on lookup.
    ccxtId: "hyperliquid",
    options: {},
  },
};

// ─── CCXTProvider ─────────────────────────────────────────────────────────────

export class CCXTProvider implements MarketDataProvider {
  readonly exchangeId: string;

  private readonly config: ExchangeConfig;
  // Lazily instantiated — avoids importing ccxt at module load time
  // (ccxt is heavy and we want to defer it until first actual use).
  private client: import("ccxt").Exchange | null = null;

  constructor(exchange: ExchangeId) {
    const cfg = EXCHANGE_CONFIGS[exchange];
    if (!cfg) {
      throw new Error(`CCXTProvider: unsupported exchange "${exchange}"`);
    }
    this.exchangeId = exchange;
    this.config = cfg;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async getClient(): Promise<import("ccxt").Exchange> {
    if (this.client) return this.client;

    // Dynamic import keeps ccxt out of the server bundle at startup.
    const ccxt = await import("ccxt");

    // ccxt default export is an object of exchange classes keyed by id.
    type CcxtModule = Record<
      string,
      new (config: Record<string, unknown>) => import("ccxt").Exchange
    >;
    const ExchangeClass = (ccxt as unknown as CcxtModule)[this.config.ccxtId];

    if (!ExchangeClass) {
      throw new Error(
        `CCXT: no exchange class found for id "${this.config.ccxtId}"`,
      );
    }

    this.client = new ExchangeClass({
      ...this.config.options,
      // Rate limiting is handled externally by RateLimiter — disable CCXT's
      // built-in throttle so we have precise control over request pacing.
      enableRateLimit: false,
    });

    return this.client;
  }

  // ── MarketDataProvider ────────────────────────────────────────────────────

  /**
   * Fetch up to `limit` closed OHLCV candles starting from `since`.
   *
   * Binance caps fetchOHLCV at 1 500 candles per call; we enforce 1 000
   * to stay well within any exchange's limit.
   *
   * The current in-progress candle (open_time + tfMs > now) is excluded —
   * only closed candles are stored.
   */
  async fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    since: Date,
    limit: number,
  ): Promise<Candle[]> {
    const client = await this.getClient();
    const tfMs = TIMEFRAME_MS[timeframe];
    const sinceMs = since.getTime();
    const safeLimit = Math.min(limit, 1_000);

    // CCXT fetchOHLCV returns: [[ts_ms, open, high, low, close, volume], …]
    const raw = await client.fetchOHLCV(symbol, timeframe, sinceMs, safeLimit);

    const now = Date.now();

    return raw
      .filter((bar) => {
        const ts = bar[0] as number;
        // Exclude any in-progress candle whose close time is in the future
        return typeof ts === "number" && ts + tfMs <= now;
      })
      .map((bar): Candle => {
        const ts = bar[0] as number;
        const openTime = new Date(ts);
        return {
          exchange: this.exchangeId as ExchangeId,
          symbol,
          timeframe,
          openTime,
          closeTime: new Date(ts + tfMs),
          open: bar[1] as number,
          high: bar[2] as number,
          low: bar[3] as number,
          close: bar[4] as number,
          volume: bar[5] as number,
          quoteVolume: 0, // basic OHLCV endpoint doesn't include quote volume
          tradeCount: null,
          closed: true,
        };
      });
  }
}
