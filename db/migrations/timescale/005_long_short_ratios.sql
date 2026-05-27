-- ─────────────────────────────────────────────────────────────────────────────
-- TimescaleDB Migration 005 — long_short_ratios hypertable
--
-- Run via:  npm run setup:timescale
-- Safe to re-run — all statements use IF NOT EXISTS.
--
-- Source: CoinGlass /long_short_account — global account-level long/short
-- ratio, aggregated across all exchanges.
-- long_ratio + short_ratio ≈ 1.0; long_short_ratio = long_ratio / short_ratio
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS long_short_ratios (
  ts                TIMESTAMPTZ      NOT NULL,
  symbol            TEXT             NOT NULL,   -- base ticker: 'BTC', 'ETH', …
  timeframe         TEXT             NOT NULL,   -- '1h', '4h', '1d'
  source            TEXT             NOT NULL DEFAULT 'coinglass',
  long_ratio        DOUBLE PRECISION NOT NULL,   -- e.g. 0.53 = 53% long accounts
  short_ratio       DOUBLE PRECISION NOT NULL,   -- e.g. 0.47
  long_short_ratio  DOUBLE PRECISION NOT NULL,   -- long_ratio / short_ratio
  PRIMARY KEY (ts, symbol, timeframe, source)
);

-- Hypertable — partition by ts, 7-day chunks
SELECT create_hypertable(
  'long_short_ratios',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_long_short_ratios_series
  ON long_short_ratios (symbol, timeframe, source, ts DESC);

ALTER TABLE long_short_ratios SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,timeframe,source',
  timescaledb.compress_orderby   = 'ts DESC'
);

SELECT add_compression_policy('long_short_ratios', INTERVAL '30 days', if_not_exists => TRUE);
