import type { Pool } from "pg";
import { getTimescalePool } from "./timescale.client";
import { TIMEFRAME_MS } from "../types";
import type { Candle, CandleQuery, Exchange, Timeframe } from "../types";

// ─── Internal row shape from pg ──────────────────────────────────────────────
// Using DOUBLE PRECISION in the schema means pg returns native JS numbers,
// not strings — no parseFloat() required.

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

// ─── Repository ──────────────────────────────────────────────────────────────

export class TimescaleRepository {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getTimescalePool();
  }

  // ── Writes ────────────────────────────────────────────────────────────────

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

  // ── Reads ─────────────────────────────────────────────────────────────────

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
   * Used by the gap-reconcile job to know where to start an incremental update.
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
    closed: true, // rows in TimescaleDB are always closed candles
  };
}
