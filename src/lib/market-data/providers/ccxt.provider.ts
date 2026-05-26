/**
 * CCXTProvider — wraps the CCXT unified API for historical market data.
 *
 * Phase 1: Binance USDT-margined perpetuals — OHLCV candles.
 * Phase 2: Bybit + OKX; funding rate history; open interest history.
 * Phase 3: replaced for Hyperliquid by NativeHyperliquidProvider.
 *
 * IMPORTANT: 'ccxt' must be listed in next.config.ts serverExternalPackages
 * so Next.js does not attempt to bundle it. CCXT uses dynamic require() calls
 * and native bindings that are incompatible with webpack bundling.
 */

import type { Exchange as ExchangeId, Timeframe, Candle, FundingRate, OpenInterest } from "../types";
import { TIMEFRAME_MS } from "../types";
import type { MarketDataProvider } from "./base";

// ─── Exchange constructor config ──────────────────────────────────────────────

interface ExchangeConfig {
  ccxtId: string;
  options: Record<string, unknown>;
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
  private client: import("ccxt").Exchange | null = null;

  constructor(exchange: ExchangeId) {
    const cfg = EXCHANGE_CONFIGS[exchange];
    if (!cfg) throw new Error(`CCXTProvider: unsupported exchange "${exchange}"`);
    this.exchangeId = exchange;
    this.config = cfg;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async getClient(): Promise<import("ccxt").Exchange> {
    if (this.client) return this.client;

    const ccxt = await import("ccxt");
    type CcxtModule = Record<
      string,
      new (config: Record<string, unknown>) => import("ccxt").Exchange
    >;
    const ExchangeClass = (ccxt as unknown as CcxtModule)[this.config.ccxtId];

    if (!ExchangeClass) {
      throw new Error(`CCXT: no exchange class found for id "${this.config.ccxtId}"`);
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
   * The current in-progress candle (open_time + tfMs > now) is excluded.
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

    const raw = await client.fetchOHLCV(symbol, timeframe, sinceMs, safeLimit);
    const now = Date.now();

    return raw
      .filter((bar) => {
        const ts = bar[0] as number;
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
          quoteVolume: 0,
          tradeCount: null,
          closed: true,
        };
      });
  }

  /**
   * Fetch historical funding rate events.
   *
   * CCXT returns: [{ symbol, fundingRate, timestamp, datetime, markPrice? }, ...]
   * Binance/Bybit limit: 1 000 per call.
   */
  async fetchFundingRates(
    symbol: string,
    since: Date,
    limit: number,
  ): Promise<FundingRate[]> {
    const client = await this.getClient();
    const safeLimit = Math.min(limit, 1_000);

    // Not all CCXT exchange instances expose fetchFundingRateHistory
    if (typeof (client as unknown as Record<string, unknown>).fetchFundingRateHistory !== "function") {
      throw new Error(
        `${this.exchangeId} does not support fetchFundingRateHistory`,
      );
    }

    type FundingEvent = {
      symbol: string;
      fundingRate: number;
      timestamp: number;
      markPrice?: number;
    };

    const raw: FundingEvent[] = await (
      client as unknown as {
        fetchFundingRateHistory: (
          symbol: string,
          since: number,
          limit: number,
        ) => Promise<FundingEvent[]>;
      }
    ).fetchFundingRateHistory(symbol, since.getTime(), safeLimit);

    return raw
      .filter((r) => typeof r.timestamp === "number" && typeof r.fundingRate === "number")
      .map((r): FundingRate => ({
        exchange: this.exchangeId as ExchangeId,
        symbol,
        fundingTime: new Date(r.timestamp),
        fundingRate: r.fundingRate,
        markPrice: r.markPrice ?? null,
      }));
  }

  /**
   * Fetch historical open interest snapshots.
   *
   * CCXT returns: [{ symbol, openInterest, openInterestValue?, timestamp }, ...]
   * Binance limit: 500 per call. OKX: 100.
   */
  async fetchOpenInterest(
    symbol: string,
    timeframe: Timeframe,
    since: Date,
    limit: number,
  ): Promise<OpenInterest[]> {
    const client = await this.getClient();
    const safeLimit = Math.min(limit, 500);

    if (typeof (client as unknown as Record<string, unknown>).fetchOpenInterestHistory !== "function") {
      throw new Error(`${this.exchangeId} does not support fetchOpenInterestHistory`);
    }

    // CCXT normalised shape for OI history entries.
    // Binance returns `openInterestAmount` (not `openInterest`), so we
    // accept both field names for cross-exchange compatibility.
    type OIEntry = {
      symbol: string;
      openInterest?: number;        // some exchanges (OKX, Bybit)
      openInterestAmount?: number;  // Binance
      openInterestValue?: number;
      timestamp: number;
    };

    // Binance and some other exchanges do not accept a `since` timestamp on the
    // OI history endpoint — passing one returns error -1130. We fetch the latest
    // `limit` records and rely on ON CONFLICT DO NOTHING for idempotency.
    const raw: OIEntry[] = await (
      client as unknown as {
        fetchOpenInterestHistory: (
          symbol: string,
          timeframe: string,
          since: number | undefined,
          limit: number,
        ) => Promise<OIEntry[]>;
      }
    ).fetchOpenInterestHistory(symbol, timeframe, undefined, safeLimit);

    return raw
      .filter((r) => {
        const oi = r.openInterestAmount ?? r.openInterest;
        return typeof r.timestamp === "number" && typeof oi === "number";
      })
      .map((r): OpenInterest => {
        const oi = (r.openInterestAmount ?? r.openInterest) as number;
        return {
          exchange: this.exchangeId as ExchangeId,
          symbol,
          timeframe,
          ts: new Date(r.timestamp),
          openInterest: oi,
          openInterestValue: r.openInterestValue ?? null,
        };
      });
  }
}
