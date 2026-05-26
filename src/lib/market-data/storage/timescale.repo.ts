import type { Pool } from "pg";
import { getTimescalePool } from "./timescale.client";
import { TIMEFRAME_MS } from "../types";
import type {
  Candle,
  CandleQuery,
  Exchange,
  Timeframe,
  FundingRate,
  FundingRateQuery,
  OpenInterest,
  OpenInterestQuery,
} from "../types";

// ─── Internal row shapes from pg ─────────────────────────────────────────────
// DOUBLE PRECISION columns → pg returns native JS numbers, no parseFloat needed.

interface CandleRow {
  open_time: Date;
  exchange: string;
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  trade_count: number | null;
}

interface FundingRateRow {
  funding_time: Date;
  exchange: string;
  symbol: string;
  funding_rate: number;
  mark_price: number | null;
}

interface OpenInterestRow {
  ts: Date;
  exchange: string;
  symbol: string;
  timeframe: string;
  open_interest: number;
  open_interest_value: number | null;
}

// ─── Coverage summary types ───────────────────────────────────────────────────

export interface CandleCoverageSeries {
  exchange: string;
  symbol: string;
  timeframe: string;
  barCount: number;
  oldestBar: Date;
  newestBar: Date;
}

export interface FundingRateCoverageSeries {
  exchange: string;
  symbol: string;
  count: number;
  oldest: Date;
  newest: Date;
}

export interface OpenInterestCoverageSeries {
  exchange: string;
  symbol: string;
  timeframe: string;
  count: number;
  oldest: Date;
  newest: Date;
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class TimescaleRepository {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getTimescalePool();
  }

  // ── Candle Writes ─────────────────────────────────────────────────────────

  /**
   * Bulk-insert candles.
   *
   * ON CONFLICT DO NOTHING makes every call idempotent: safe to re-run on
   * the same range without creating duplicates.
   *
   * Returns the number of rows actually written (0 if all duplicates).
   */
  async insertCandles(candles: Candle[]): Promise<number> {
    if (candles.length === 0) return 0;

    const values: unknown[] = [];
    const rows: string[] = [];
    let p = 1;

    for (const c of candles) {
      rows.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        c.openTime,
        c.exchange,
        c.symbol,
        c.timeframe,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.quoteVolume,
      );
    }

    const sql = `
      INSERT INTO candles
        (open_time, exchange, symbol, timeframe,
         open, high, low, close, volume, quote_volume)
      VALUES ${rows.join(",")}
      ON CONFLICT DO NOTHING
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, values);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  // ── Candle Reads ──────────────────────────────────────────────────────────

  /**
   * Fetch a time-range of candles ordered by open_time ASC.
   * Optionally capped by `limit`.
   */
  async queryCandles(query: CandleQuery): Promise<Candle[]> {
    const { exchange, symbol, timeframe, startTime, endTime, limit } = query;

    const params: unknown[] = [exchange, symbol, timeframe, startTime, endTime];
    let sql = `
      SELECT open_time, exchange, symbol, timeframe,
             open, high, low, close, volume, quote_volume, trade_count
      FROM   candles
      WHERE  exchange  = $1
        AND  symbol    = $2
        AND  timeframe = $3
        AND  open_time >= $4
        AND  open_time <  $5
      ORDER  BY open_time ASC
    `;

    if (limit != null) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await this.pool.query<CandleRow>(sql, params);
    return result.rows.map(rowToCandle);
  }

  /**
   * Return only the open_time values present in the given range.
   * Used by GapDetector — avoids loading full OHLCV rows.
   */
  async queryExistingTimestamps(
    exchange: Exchange,
    symbol: string,
    timeframe: Timeframe,
    startTime: Date,
    endTime: Date,
  ): Promise<Date[]> {
    const result = await this.pool.query<{ open_time: Date }>(
      `SELECT open_time
       FROM   candles
       WHERE  exchange  = $1
         AND  symbol    = $2
         AND  timeframe = $3
         AND  open_time >= $4
         AND  open_time <  $5
       ORDER  BY open_time ASC`,
      [exchange, symbol, timeframe, startTime, endTime],
    );
    return result.rows.map((r) =>
      r.open_time instanceof Date ? r.open_time : new Date(r.open_time),
    );
  }

  /**
   * The most recent candle open_time for this series, or null if no data.
   */
  async getLatestOpenTime(
    exchange: Exchange,
    symbol: string,
    timeframe: Timeframe,
  ): Promise<Date | null> {
    const result = await this.pool.query<{ open_time: Date }>(
      `SELECT open_time
       FROM   candles
       WHERE  exchange  = $1 AND symbol = $2 AND timeframe = $3
       ORDER  BY open_time DESC
       LIMIT  1`,
      [exchange, symbol, timeframe],
    );
    const raw = result.rows[0]?.open_time;
    if (!raw) return null;
    return raw instanceof Date ? raw : new Date(raw);
  }

  /** Row count for a range — used by coverage checks. */
  async countCandles(
    exchange: Exchange,
    symbol: string,
    timeframe: Timeframe,
    startTime: Date,
    endTime: Date,
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM   candles
       WHERE  exchange  = $1
         AND  symbol    = $2
         AND  timeframe = $3
         AND  open_time >= $4
         AND  open_time <  $5`,
      [exchange, symbol, timeframe, startTime, endTime],
    );
    return parseInt(result.rows[0].count, 10);
  }

  // ── Funding Rate Writes ───────────────────────────────────────────────────

  async insertFundingRates(rates: FundingRate[]): Promise<number> {
    if (rates.length === 0) return 0;

    const values: unknown[] = [];
    const rows: string[] = [];
    let p = 1;

    for (const r of rates) {
      rows.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
      values.push(r.fundingTime, r.exchange, r.symbol, r.fundingRate, r.markPrice ?? null);
    }

    const sql = `
      INSERT INTO funding_rates (funding_time, exchange, symbol, funding_rate, mark_price)
      VALUES ${rows.join(",")}
      ON CONFLICT DO NOTHING
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, values);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  // ── Funding Rate Reads ────────────────────────────────────────────────────

  async queryFundingRates(query: FundingRateQuery): Promise<FundingRate[]> {
    const { exchange, symbol, startTime, endTime, limit } = query;
    const params: unknown[] = [exchange, symbol, startTime, endTime];

    let sql = `
      SELECT funding_time, exchange, symbol, funding_rate, mark_price
      FROM   funding_rates
      WHERE  exchange     = $1
        AND  symbol       = $2
        AND  funding_time >= $3
        AND  funding_time <  $4
      ORDER  BY funding_time ASC
    `;

    if (limit != null) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await this.pool.query<FundingRateRow>(sql, params);
    return result.rows.map(rowToFundingRate);
  }

  async getLatestFundingTime(
    exchange: Exchange,
    symbol: string,
  ): Promise<Date | null> {
    const result = await this.pool.query<{ funding_time: Date }>(
      `SELECT funding_time FROM funding_rates
       WHERE exchange = $1 AND symbol = $2
       ORDER BY funding_time DESC LIMIT 1`,
      [exchange, symbol],
    );
    const raw = result.rows[0]?.funding_time;
    if (!raw) return null;
    return raw instanceof Date ? raw : new Date(raw);
  }

  // ── Open Interest Writes ──────────────────────────────────────────────────

  async insertOpenInterest(rows: OpenInterest[]): Promise<number> {
    if (rows.length === 0) return 0;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const r of rows) {
      placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      values.push(r.ts, r.exchange, r.symbol, r.timeframe, r.openInterest, r.openInterestValue ?? null);
    }

    const sql = `
      INSERT INTO open_interest (ts, exchange, symbol, timeframe, open_interest, open_interest_value)
      VALUES ${placeholders.join(",")}
      ON CONFLICT DO NOTHING
    `;

    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, values);
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  // ── Open Interest Reads ───────────────────────────────────────────────────

  async queryOpenInterest(query: OpenInterestQuery): Promise<OpenInterest[]> {
    const { exchange, symbol, timeframe, startTime, endTime, limit } = query;
    const params: unknown[] = [exchange, symbol, timeframe, startTime, endTime];

    let sql = `
      SELECT ts, exchange, symbol, timeframe, open_interest, open_interest_value
      FROM   open_interest
      WHERE  exchange  = $1
        AND  symbol    = $2
        AND  timeframe = $3
        AND  ts        >= $4
        AND  ts        <  $5
      ORDER  BY ts ASC
    `;

    if (limit != null) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await this.pool.query<OpenInterestRow>(sql, params);
    return result.rows.map(rowToOpenInterest);
  }

  async getLatestOpenInterestTime(
    exchange: Exchange,
    symbol: string,
    timeframe: Timeframe,
  ): Promise<Date | null> {
    const result = await this.pool.query<{ ts: Date }>(
      `SELECT ts FROM open_interest
       WHERE exchange = $1 AND symbol = $2 AND timeframe = $3
       ORDER BY ts DESC LIMIT 1`,
      [exchange, symbol, timeframe],
    );
    const raw = result.rows[0]?.ts;
    if (!raw) return null;
    return raw instanceof Date ? raw : new Date(raw);
  }

  // ── Coverage Stats ────────────────────────────────────────────────────────

  /** Per-series summary of candle data in TimescaleDB. */
  async getCandleCoverage(): Promise<CandleCoverageSeries[]> {
    const result = await this.pool.query<{
      exchange: string;
      symbol: string;
      timeframe: string;
      bar_count: string;
      oldest_bar: Date;
      newest_bar: Date;
    }>(
      `SELECT exchange, symbol, timeframe,
              COUNT(*) AS bar_count,
              MIN(open_time) AS oldest_bar,
              MAX(open_time) AS newest_bar
       FROM   candles
       GROUP  BY exchange, symbol, timeframe
       ORDER  BY exchange, symbol, timeframe`,
    );

    return result.rows.map((r) => ({
      exchange: r.exchange,
      symbol: r.symbol,
      timeframe: r.timeframe,
      barCount: parseInt(r.bar_count, 10),
      oldestBar: r.oldest_bar instanceof Date ? r.oldest_bar : new Date(r.oldest_bar),
      newestBar: r.newest_bar instanceof Date ? r.newest_bar : new Date(r.newest_bar),
    }));
  }

  /** Per-series summary of funding rate data. */
  async getFundingRateCoverage(): Promise<FundingRateCoverageSeries[]> {
    const result = await this.pool.query<{
      exchange: string;
      symbol: string;
      count: string;
      oldest: Date;
      newest: Date;
    }>(
      `SELECT exchange, symbol,
              COUNT(*) AS count,
              MIN(funding_time) AS oldest,
              MAX(funding_time) AS newest
       FROM   funding_rates
       GROUP  BY exchange, symbol
       ORDER  BY exchange, symbol`,
    );

    return result.rows.map((r) => ({
      exchange: r.exchange,
      symbol: r.symbol,
      count: parseInt(r.count, 10),
      oldest: r.oldest instanceof Date ? r.oldest : new Date(r.oldest),
      newest: r.newest instanceof Date ? r.newest : new Date(r.newest),
    }));
  }

  /** Per-series summary of open interest data. */
  async getOpenInterestCoverage(): Promise<OpenInterestCoverageSeries[]> {
    const result = await this.pool.query<{
      exchange: string;
      symbol: string;
      timeframe: string;
      count: string;
      oldest: Date;
      newest: Date;
    }>(
      `SELECT exchange, symbol, timeframe,
              COUNT(*) AS count,
              MIN(ts) AS oldest,
              MAX(ts) AS newest
       FROM   open_interest
       GROUP  BY exchange, symbol, timeframe
       ORDER  BY exchange, symbol, timeframe`,
    );

    return result.rows.map((r) => ({
      exchange: r.exchange,
      symbol: r.symbol,
      timeframe: r.timeframe,
      count: parseInt(r.count, 10),
      oldest: r.oldest instanceof Date ? r.oldest : new Date(r.oldest),
      newest: r.newest instanceof Date ? r.newest : new Date(r.newest),
    }));
  }
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _repo: TimescaleRepository | undefined;

export function getTimescaleRepo(): TimescaleRepository {
  if (!_repo) _repo = new TimescaleRepository();
  return _repo;
}

// ─── Row → domain type conversion ────────────────────────────────────────────

function rowToCandle(row: CandleRow): Candle {
  const openTime =
    row.open_time instanceof Date ? row.open_time : new Date(row.open_time);
  const tf = row.timeframe as Timeframe;
  const tfMs = TIMEFRAME_MS[tf] ?? 0;

  return {
    exchange: row.exchange as Exchange,
    symbol: row.symbol,
    timeframe: tf,
    openTime,
    closeTime: new Date(openTime.getTime() + tfMs),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    quoteVolume: row.quote_volume,
    tradeCount: row.trade_count,
    closed: true,
  };
}

function rowToFundingRate(row: FundingRateRow): FundingRate {
  return {
    exchange: row.exchange as Exchange,
    symbol: row.symbol,
    fundingTime: row.funding_time instanceof Date ? row.funding_time : new Date(row.funding_time),
    fundingRate: row.funding_rate,
    markPrice: row.mark_price,
  };
}

function rowToOpenInterest(row: OpenInterestRow): OpenInterest {
  return {
    exchange: row.exchange as Exchange,
    symbol: row.symbol,
    timeframe: row.timeframe as Timeframe,
    ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
    openInterest: row.open_interest,
    openInterestValue: row.open_interest_value,
  };
}
