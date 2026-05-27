-- ─────────────────────────────────────────────────────────────────────────────
-- TimescaleDB Migration 004 — liquidations hypertable
--
-- Run via:  npm run setup:timescale
-- Safe to re-run — all statements use IF NOT EXISTS.
--
-- Source: CoinGlass /liquidation_chart — aggregated across all exchanges.
-- Columns buy_liq_usd = long positions liquidated (USD)
--         sell_liq_usd = short positions liquidated (USD)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS liquidations (
  ts              TIMESTAMPTZ      NOT NULL,
  symbol          TEXT             NOT NULL,   -- base ticker: 'BTC', 'ETH', …
  timeframe       TEXT             NOT NULL,   -- '1h', '4h', '1d'
  source          TEXT             NOT NULL DEFAULT 'coinglass',
  buy_liq_usd     DOUBLE PRECISION NOT NULL,   -- long liquidations in USD
  sell_liq_usd    DOUBLE PRECISION NOT NULL,   -- short liquidations in USD
  PRIMARY KEY (ts, symbol, timeframe, source)
);

-- Hypertable — partition by ts, 7-day chunks
SELECT create_hypertable(
  'liquidations',
  'ts',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- Index matching common query: WHERE symbol=? AND timeframe=? AND ts BETWEEN ...
CREATE UNIQUE INDEX IF NOT EXISTS idx_liquidations_series
  ON liquidations (symbol, timeframe, source, ts DESC);

ALTER TABLE liquidations SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol,timeframe,source',
  timescaledb.compress_orderby   = 'ts DESC'
);

SELECT add_compression_policy('liquidations', INTERVAL '30 days', if_not_exists => TRUE);
