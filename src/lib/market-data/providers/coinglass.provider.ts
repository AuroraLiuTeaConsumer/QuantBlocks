/**
 * CoinGlassProvider — REST client for the CoinGlass public v2 API.
 *
 * Base URL: https://open-api.coinglass.com/public/v2
 * Auth:     header `coinglassSecret: <COINGLASS_API_KEY>`
 *
 * This is NOT a MarketDataProvider — that interface is exchange-specific for
 * OHLCV / funding / OI. CoinGlassProvider is a standalone client accessed
 * directly by the dedicated ingestion services.
 *
 * CoinGlass returns the full available history for a symbol+timeType in a
 * single response — no cursor paging needed.
 *
 * Rate limits: free tier ~30 req/min. Each ingest makes one request per
 * data type, so no throttling is needed unless batch-ingesting many symbols.
 *
 * Environment variable: COINGLASS_API_KEY
 */

import type { Liquidation, LongShortRatio } from "../types";

const BASE_URL = "https://open-api.coinglass.com/public/v2";

/** Maps CGTimeframe string → CoinGlass timeType integer */
const TF_TO_TIMETYPE: Record<string, number> = {
  "1h": 0,
  "4h": 1,
  "1d": 3,
};

// ─── Raw response shapes ──────────────────────────────────────────────────────

interface CGLiquidationRow {
  t: number;                 // epoch ms
  buyLiquidationUsd: number;
  sellLiquidationUsd: number;
}

interface CGLongShortRow {
  t: number;                 // epoch ms
  longAccount: number;       // fraction of longs, e.g. 0.53
  shortAccount: number;      // fraction of shorts
  longShortRatio: number;    // longAccount / shortAccount
}

interface CGResponse<T> {
  code: string;
  msg?: string;
  data: T[];
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class CoinGlassProvider {
  private readonly apiKey: string;

  constructor() {
    const key = process.env.COINGLASS_API_KEY;
    if (!key) throw new Error("COINGLASS_API_KEY is not set");
    this.apiKey = key;
  }

  /** True when COINGLASS_API_KEY is present — use before constructing. */
  static isConfigured(): boolean {
    return Boolean(process.env.COINGLASS_API_KEY);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      headers: { coinglassSecret: this.apiKey },
      cache: "no-store", // never serve stale data via Next.js fetch cache
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new Error(`CoinGlass HTTP ${res.status} for ${path}: ${body}`);
    }

    const json = (await res.json()) as CGResponse<T>;
    if (json.code !== "0") {
      throw new Error(
        `CoinGlass API error code=${json.code} msg=${json.msg ?? "(none)"}`,
      );
    }

    return Array.isArray(json.data) ? json.data : [];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Fetch global liquidation chart for a symbol.
   *
   * @param symbol    Base ticker, e.g. 'BTC'
   * @param timeframe '1h' | '4h' | '1d'
   */
  async fetchLiquidations(
    symbol: string,
    timeframe: string,
  ): Promise<Liquidation[]> {
    const timeType = TF_TO_TIMETYPE[timeframe];
    if (timeType === undefined) {
      throw new Error(
        `Unsupported timeframe for CoinGlass liquidations: "${timeframe}". Use 1h | 4h | 1d`,
      );
    }

    const rows = await this.get<CGLiquidationRow>("/liquidation_chart", {
      symbol,
      timeType: String(timeType),
    });

    return rows
      .filter(
        (r) =>
          typeof r.t === "number" &&
          typeof r.buyLiquidationUsd === "number" &&
          typeof r.sellLiquidationUsd === "number",
      )
      .map(
        (r): Liquidation => ({
          ts: new Date(r.t),
          symbol,
          timeframe,
          source: "coinglass",
          buyLiqUsd: r.buyLiquidationUsd,
          sellLiqUsd: r.sellLiquidationUsd,
        }),
      );
  }

  /**
   * Fetch global long/short account ratio data for a symbol.
   *
   * @param symbol    Base ticker, e.g. 'BTC'
   * @param timeframe '1h' | '4h' | '1d'
   */
  async fetchLongShortRatios(
    symbol: string,
    timeframe: string,
  ): Promise<LongShortRatio[]> {
    const timeType = TF_TO_TIMETYPE[timeframe];
    if (timeType === undefined) {
      throw new Error(
        `Unsupported timeframe for CoinGlass long/short: "${timeframe}". Use 1h | 4h | 1d`,
      );
    }

    const rows = await this.get<CGLongShortRow>("/long_short_account", {
      symbol,
      timeType: String(timeType),
    });

    return rows
      .filter(
        (r) =>
          typeof r.t === "number" &&
          typeof r.longAccount === "number" &&
          typeof r.shortAccount === "number" &&
          typeof r.longShortRatio === "number",
      )
      .map(
        (r): LongShortRatio => ({
          ts: new Date(r.t),
          symbol,
          timeframe,
          source: "coinglass",
          longRatio: r.longAccount,
          shortRatio: r.shortAccount,
          longShortRatio: r.longShortRatio,
        }),
      );
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _cgProvider: CoinGlassProvider | undefined;

/**
 * Return the shared CoinGlassProvider instance.
 * Call CoinGlassProvider.isConfigured() first; this throws if the key is missing.
 */
export function getCoinGlassProvider(): CoinGlassProvider {
  if (!_cgProvider) _cgProvider = new CoinGlassProvider();
  return _cgProvider;
}
