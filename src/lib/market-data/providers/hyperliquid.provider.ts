/**
 * NativeHyperliquidProvider — calls the Hyperliquid REST API directly.
 *
 * Hyperliquid does not have a CCXT integration that supports all the endpoints
 * we need, so we talk to their info endpoint ourselves.
 *
 * API base: https://api.hyperliquid.xyz/info
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 *
 * Candle format: POST { type: "candleSnapshot", req: { coin, interval, startTime, endTime } }
 *   Response: Array<[t, T, s, i, o, c, h, l, v, n]> where t=openMs, T=closeMs,
 *             s=coin, i=interval, o=open, c=close, h=high, l=low, v=volume, n=trades
 *
 * Funding format: POST { type: "fundingHistory", req: { coin, startTime, endTime? } }
 *   Response: Array<{ coin, fundingRate, premium, time }>
 *
 * Open interest: Not supported — returns empty array.
 *
 * Symbol convention: Hyperliquid uses the coin ticker alone (e.g. "BTC", "ETH"),
 * NOT CCXT unified format. This provider extracts the base asset from the CCXT
 * symbol automatically: "BTC/USDT:USDT" → "BTC".
 */

import type { Candle, FundingRate, OpenInterest, Timeframe } from "../types";
import type { MarketDataProvider } from "./base";

const INFO_URL = "https://api.hyperliquid.xyz/info";

// Map QuantBlocks / CCXT timeframe strings to Hyperliquid interval strings
const TF_TO_HL: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

// Candle snapshot entry returned by Hyperliquid
interface HLCandleEntry {
  t: number;  // open time ms
  T: number;  // close time ms
  s: string;  // coin
  i: string;  // interval
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;  // trade count
}

interface HLFundingEntry {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number; // ms
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Extract Hyperliquid coin name from CCXT unified symbol, e.g. "BTC/USDT:USDT" → "BTC" */
function coinFromSymbol(symbol: string): string {
  return symbol.split("/")[0];
}

async function postInfo<T>(body: unknown): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Hyperliquid API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class NativeHyperliquidProvider implements MarketDataProvider {
  readonly exchangeId = "hyperliquid";

  async fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    since: Date,
    limit: number,
  ): Promise<Candle[]> {
    const coin = coinFromSymbol(symbol);
    const interval = TF_TO_HL[timeframe] ?? timeframe;

    // Hyperliquid returns up to 5 000 candles per request
    // We request [since, since + limit * tfMs] to get exactly the right window
    const tfMs = timeframeToDurationMs(timeframe);
    const endTime = new Date(since.getTime() + limit * tfMs);

    const entries = await postInfo<HLCandleEntry[]>({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime: since.getTime(),
        endTime: endTime.getTime(),
      },
    });

    if (!Array.isArray(entries)) return [];

    return entries.slice(0, limit).map((e) => {
      const openTime = new Date(e.t);
      const closeTime = new Date(e.T);
      return {
        exchange: "hyperliquid" as const,
        symbol,
        timeframe,
        openTime,
        closeTime,
        open: parseFloat(e.o),
        high: parseFloat(e.h),
        low: parseFloat(e.l),
        close: parseFloat(e.c),
        volume: parseFloat(e.v),
        quoteVolume: 0, // not provided
        tradeCount: e.n,
        closed: true,
      };
    });
  }

  async fetchFundingRates(
    symbol: string,
    since: Date,
    limit: number,
  ): Promise<FundingRate[]> {
    const coin = coinFromSymbol(symbol);

    const entries = await postInfo<HLFundingEntry[]>({
      type: "fundingHistory",
      req: {
        coin,
        startTime: since.getTime(),
      },
    });

    if (!Array.isArray(entries)) return [];

    return entries.slice(0, limit).map((e) => ({
      exchange: "hyperliquid" as const,
      symbol,
      fundingTime: new Date(e.time),
      fundingRate: parseFloat(e.fundingRate),
      markPrice: null, // not directly provided in this endpoint
    }));
  }

  async fetchOpenInterest(
    _symbol: string,
    _timeframe: Timeframe,
    _since: Date,
    _limit: number,
  ): Promise<OpenInterest[]> {
    // Hyperliquid does not expose a historical OI timeseries endpoint
    return [];
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function timeframeToDurationMs(tf: string): number {
  const match = tf.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3_600_000;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: return 3_600_000;
  }
}
