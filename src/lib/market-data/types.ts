// ─── Exchange / Timeframe ─────────────────────────────────────────────────────

export type Exchange = "binance" | "bybit" | "okx" | "hyperliquid";

export const TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Duration of each timeframe in milliseconds. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export function isTimeframe(s: string): s is Timeframe {
  return TIMEFRAMES.includes(s as Timeframe);
}

// ─── Normalized Market Data Types ────────────────────────────────────────────

/**
 * Full market-data candle as stored in TimescaleDB.
 * This is richer than the simple Candle shape used inside backtest.ts.
 * BacktestDataLoader converts between the two.
 */
export interface Candle {
  exchange: Exchange;
  symbol: string; // CCXT unified format: 'BTC/USDT:USDT'
  timeframe: Timeframe;
  openTime: Date; // UTC — the candle's open timestamp
  closeTime: Date; // openTime + timeframe duration
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base-asset volume
  quoteVolume: number; // quote-asset (USDT) volume
  tradeCount: number | null;
  closed: boolean; // false = candle is still in progress
}

/**
 * Perpetual futures funding rate event.
 * Funding payments happen every 8 hours on Binance / Bybit / OKX.
 */
export interface FundingRate {
  exchange: Exchange;
  symbol: string;
  fundingTime: Date;
  fundingRate: number; // decimal, e.g. 0.0001 = 0.01%
  markPrice: number | null;
}

/**
 * Open interest snapshot at a given timestamp.
 * Granularity matches the timeframe (e.g. '1h' = hourly snapshots).
 */
export interface OpenInterest {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  ts: Date;
  openInterest: number; // base-asset quantity
  openInterestValue: number | null; // quote currency value
}

// ─── Query Types ─────────────────────────────────────────────────────────────

export interface CandleQuery {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
  limit?: number;
}

export interface FundingRateQuery {
  exchange: Exchange;
  symbol: string;
  startTime: Date;
  endTime: Date;
  limit?: number;
}

export interface OpenInterestQuery {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
  limit?: number;
}

export interface DataCoverage {
  totalInDb: number;
  expectedTotal: number;
  coveragePct: number;
  /** true when coverage >= 80% */
  sufficient: boolean;
}

// ─── Ingestion Types ─────────────────────────────────────────────────────────

export interface IngestionJobSpec {
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime: Date;
  endTime: Date;
}

export interface QualityReport {
  totalChecked: number;
  ohlcErrors: number;
  negativePrices: number;
  volumeErrors: number;
  spikeWarnings: number;
}

export interface IngestionResult {
  rowsInserted: number;
  gapsFilled: number;
  durationMs: number;
  quality?: QualityReport;
}

// ─── Symbol / Instrument Mapping ─────────────────────────────────────────────

/** Maps a QuantBlocks internal instrument ID to a provider + CCXT symbol. */
export interface InstrumentMapping {
  exchange: Exchange;
  symbol: string; // CCXT unified, e.g. 'BTC/USDT:USDT'
}

/**
 * Canonical map from QuantBlocks instrument → exchange + CCXT symbol.
 *
 * Naming convention: <BASE>-PERP[-<EXCHANGE>]
 *   - No suffix  → default exchange (Binance)
 *   - -BYBIT     → Bybit
 *   - -OKX       → OKX
 */
export const INSTRUMENT_MAP: Record<string, InstrumentMapping> = {
  // ── Binance (default) ────────────────────────────────────────────────────
  "BTC-PERP": { exchange: "binance", symbol: "BTC/USDT:USDT" },
  "ETH-PERP": { exchange: "binance", symbol: "ETH/USDT:USDT" },
  "SOL-PERP": { exchange: "binance", symbol: "SOL/USDT:USDT" },
  "BNB-PERP": { exchange: "binance", symbol: "BNB/USDT:USDT" },
  "XRP-PERP": { exchange: "binance", symbol: "XRP/USDT:USDT" },
  "DOGE-PERP": { exchange: "binance", symbol: "DOGE/USDT:USDT" },

  // ── Bybit ────────────────────────────────────────────────────────────────
  "BTC-PERP-BYBIT": { exchange: "bybit", symbol: "BTC/USDT:USDT" },
  "ETH-PERP-BYBIT": { exchange: "bybit", symbol: "ETH/USDT:USDT" },
  "SOL-PERP-BYBIT": { exchange: "bybit", symbol: "SOL/USDT:USDT" },

  // ── OKX ──────────────────────────────────────────────────────────────────
  "BTC-PERP-OKX": { exchange: "okx", symbol: "BTC/USDT:USDT" },
  "ETH-PERP-OKX": { exchange: "okx", symbol: "ETH/USDT:USDT" },
};

/**
 * Resolve a QuantBlocks instrument ID to an exchange + CCXT symbol.
 * Returns null if the instrument is not yet mapped.
 */
export function resolveInstrument(instrument: string): InstrumentMapping | null {
  return INSTRUMENT_MAP[instrument] ?? null;
}
