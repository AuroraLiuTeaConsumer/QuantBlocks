# Code Review / Debugger Memory — QuantBlocks

- [Duplicate QualityReport types](project_quality-report-duplication.md) — two structurally-identical QualityReport interfaces exist; assignments compile by structural typing only.
- [Backtest dataQuality two paths](project_backtest-dataquality-paths.md) — dataQuality populated from two non-identical sources (cached full-window check vs per-page ingest aggregate).
