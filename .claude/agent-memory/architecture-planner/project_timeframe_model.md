---
name: project-timeframe-model
description: Multi-timeframe design — timeframe is a Strategy-level property; backend is already fully tf-parametric, only frontend hardcodes 1h
metadata:
  type: project
---

Timeframe is a **Strategy-level property** (`Strategy.timeframe`), inherited by paper sessions (`PaperSession.timeframe`) and backtests at start. There is no per-run timeframe override.

**Why:** All runtime plumbing keys off `strategy.timeframe` / `session.timeframe`: Redis candle channels are `candles:{exchange}:{symbol}:{timeframe}` ([[project-worker-mode-split]]), `getWorkerSubscriptions`/`getActiveSessions` in registry.ts filter/dedupe by timeframe, replay.ts uses `TIMEFRAME_MS[tf]`, poll + start routes validate via `isTimeframe`. `advance.ts` is timeframe-agnostic ([[project-advance-idempotency]]). Candles live in ONE `candles` hypertable with a `timeframe` column (not per-tf tables). `TIMEFRAMES` tuple in `lib/market-data/types.ts` already lists 1m,3m,5m,15m,30m,1h,4h,1d.

**How to apply:** The backend is ~95% multi-timeframe ready. To enable multi-tf, the real gaps are frontend + ingest, NOT the engine:
1. Frontend hardcodes 1h — create form (`app/strategies/page.tsx` ~line 91 `timeframe: "1h"`) and workspace header (`StrategyWorkspace.tsx` ~157-159) shows tf read-only. No UI ever PUTs a different timeframe.
2. `POST`/`PUT /api/strategies` persist an arbitrary `timeframe` string with NO validation against `TIMEFRAMES` — should validate.
3. `ws-ingest.job.ts` publishes live candles for only ONE `--timeframe` (default 1m). Worker-mode sessions on other tfs get no live candles (poll mode still works off TimescaleDB). For live multi-tf, ws-ingest must subscribe to multiple kline streams.
4. `bars/route.ts` synthetic `TIMEFRAME_SECONDS` map omits 3m/30m.
Recommend chart stays coupled to strategy/session timeframe (don't add an engine-independent chart tf that would desync candles from trades/equity).
