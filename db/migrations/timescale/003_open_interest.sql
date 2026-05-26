-- ─────────────────────────────────────────────────────────────────────────────
-- TimescaleDB Migration 003 — open_interest hypertable
--
-- Run via:  npm run setup:timescale
-- Safe to re-run — all statements use IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- Open interest snapshots keyed by exchange + symbol + timeframe + timestamp.
-- timeframe determines snapshot granularity (e.g. '1h' = hourly OI snapshots).
CREATE TABLE IF NOT EXISTS open_interest (
  ts                  TIMESTAMPTZ      NOT NULL,
  exchange            TEXT             NOT NULL,
  symbol              TEXT             NOT NULL,
  timeframe           TEXT             NOT NULL,   -- snapshot resolution, e.g. '1h'
  open_interest       DOUBLE PRECISION NOT NULL,   -- base-asset quantity
  open_interest_value DOUBLE PRECISION,            -- quote currency value (USDT)
  PRIMARY KEY (ts, exchange, symbol, timeframe)
);

-- Hypertable — partition by ts, 7-day chunks
SELECT create_hypertable(
  'open_interest',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- Index matching common query: WHERE exchange=? AND symbol=? AND timeframe=? AND ts BETWEEN ...
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_interest_series
  ON open_interest (exchange, symbol, timeframe, ts DESC);

ALTER TABLE open_interest SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'exchange,symbol,timeframe',
  timescaledb.compress_orderby   = 'ts DESC'
);

SELECT add_compression_policy('open_interest', INTERVAL '30 days', if_not_exists => TRUE);
