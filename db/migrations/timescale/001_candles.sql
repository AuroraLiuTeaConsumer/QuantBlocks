-- ─────────────────────────────────────────────────────────────────────────────
-- TimescaleDB Migration 001 — candles hypertable
--
-- Run via:  npm run setup:timescale
-- Safe to re-run — all statements use IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 2. Candles table
--    DOUBLE PRECISION for OHLCV:
--      • pg returns native JS numbers (no string-to-float parsing overhead)
--      • ~15 significant digits — sufficient for any crypto price
CREATE TABLE IF NOT EXISTS candles (
  open_time     TIMESTAMPTZ      NOT NULL,
  exchange      TEXT             NOT NULL,   -- 'binance', 'bybit', 'okx', …
  symbol        TEXT             NOT NULL,   -- CCXT unified: 'BTC/USDT:USDT'
  timeframe     TEXT             NOT NULL,   -- '1m', '5m', '1h', '4h', '1d'
  open          DOUBLE PRECISION NOT NULL,
  high          DOUBLE PRECISION NOT NULL,
  low           DOUBLE PRECISION NOT NULL,
  close         DOUBLE PRECISION NOT NULL,
  volume        DOUBLE PRECISION NOT NULL,   -- base-asset volume
  quote_volume  DOUBLE PRECISION NOT NULL DEFAULT 0,
  trade_count   INTEGER,
  PRIMARY KEY (open_time, exchange, symbol, timeframe)
);

-- 3. Hypertable — partition by open_time, 7-day chunks
--    Chunks align well with weekly ingestion jobs and compression windows.
SELECT create_hypertable(
  'candles',
  'open_time',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- 4. Covering index optimised for the most common query pattern:
--      WHERE exchange = ? AND symbol = ? AND timeframe = ?
--      AND open_time BETWEEN ? AND ?
--      ORDER BY open_time ASC
--    DESC on open_time lets TimescaleDB use its "recent-first" chunk scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candles_series
  ON candles (exchange, symbol, timeframe, open_time DESC);

-- 5. Compression — segments match the covering index so each chunk compresses
--    into one segment per (exchange, symbol, timeframe) triple.
ALTER TABLE candles SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'exchange,symbol,timeframe',
  timescaledb.compress_orderby   = 'open_time DESC'
);

-- Compress chunks older than 30 days.
SELECT add_compression_policy('candles', INTERVAL '30 days', if_not_exists => TRUE);
