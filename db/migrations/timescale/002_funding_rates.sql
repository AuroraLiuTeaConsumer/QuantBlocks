-- ─────────────────────────────────────────────────────────────────────────────
-- TimescaleDB Migration 002 — funding_rates hypertable
--
-- Run via:  npm run setup:timescale
-- Safe to re-run — all statements use IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- Funding payments happen every 8 hours on most perpetual exchanges.
-- We store each funding event: rate, mark price, and the scheduled funding time.
CREATE TABLE IF NOT EXISTS funding_rates (
  funding_time  TIMESTAMPTZ      NOT NULL,
  exchange      TEXT             NOT NULL,   -- 'binance', 'bybit', 'okx', …
  symbol        TEXT             NOT NULL,   -- CCXT unified: 'BTC/USDT:USDT'
  funding_rate  DOUBLE PRECISION NOT NULL,   -- decimal, e.g. 0.0001 = 0.01%
  mark_price    DOUBLE PRECISION,            -- mark price at funding time (nullable)
  PRIMARY KEY (funding_time, exchange, symbol)
);

-- Hypertable — partition by funding_time, 1-day chunks
-- Funding events are sparse (3/day) so 1-day chunks keep TimescaleDB planning fast.
SELECT create_hypertable(
  'funding_rates',
  'funding_time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

-- Index for the most common query: latest N funding rates for a series
CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_rates_series
  ON funding_rates (exchange, symbol, funding_time DESC);

-- Compress old funding data (savings are smaller than candles but still worthwhile)
ALTER TABLE funding_rates SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'exchange,symbol',
  timescaledb.compress_orderby   = 'funding_time DESC'
);

SELECT add_compression_policy('funding_rates', INTERVAL '7 days', if_not_exists => TRUE);
