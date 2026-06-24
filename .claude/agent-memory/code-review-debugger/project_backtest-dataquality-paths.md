---
name: backtest-dataquality-paths
description: dataQuality in backtest API comes from two non-identical sources depending on cache hit vs auto-ingest
metadata:
  type: project
---

In `src/app/api/strategies/[id]/backtests/route.ts`, the `dataQuality` field is set from two different sources:
- Happy path (cache hit): `checkCandleQuality` over the full contiguous stored window in one call.
- Auto-ingest path (cache miss): `ingestResult.quality` — a per-fetched-page aggregate summed in `historical-service.ts`, which (a) only covers gap-filled candles, not pre-existing ones, and (b) misses spike detection across page boundaries (each page's bar 0 has no predecessor).

This was the W1 fix (always populate dataQuality so the UI Data Quality panel stops appearing/disappearing). The fix is correct, but the two reports are similar-not-identical, mainly in `spikeWarnings` and `totalChecked`.

UI gate: `BacktestPanel.tsx` renders the panel only when `dataQuality.totalChecked > 0`. The happy path can't reach the check with an empty array because the data-loader throws `InsufficientDataError` when `candles.length === 0` / coverage < MIN_COVERAGE_PCT.

**Why:** W1 non-determinism in the Data Quality panel; fix added a quality check on the cache-hit path.

**How to apply:** Don't assume the two paths produce equal reports. If MIN_COVERAGE_PCT is ever lowered to 0, re-check the W1 invariant (empty-array → panel hidden). Related: [[quality-report-duplication]].
