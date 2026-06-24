---
name: quality-report-duplication
description: Two independent structurally-identical QualityReport interfaces exist; cross-assignment relies on structural typing
metadata:
  type: project
---

`QualityReport` is declared twice: `src/lib/market-data/ingestion/quality-checker.ts` (exported alongside `checkCandleQuality`) and `src/lib/market-data/types.ts` (canonical, used by `IngestionResult`). They are field-for-field identical (totalChecked, ohlcErrors, negativePrices, volumeErrors, spikeWarnings).

**Why:** Likely organic growth — the checker declared its own type; types.ts added one for the ingestion result shape.

**How to apply:** When reviewing changes that add a field to one QualityReport, flag that the other must be updated too. Cross-assignments (e.g. in the backtests route) compile only because the shapes match structurally — they will break confusingly if they diverge. Related: [[backtest-dataquality-paths]].
