# Code Review / Debugger Memory — QuantBlocks

- [Duplicate QualityReport types](project_quality-report-duplication.md) — two structurally-identical QualityReport interfaces exist; assignments compile by structural typing only.
- [Backtest dataQuality two paths](project_backtest-dataquality-paths.md) — dataQuality populated from two non-identical sources (cached full-window check vs per-page ingest aggregate).
- [Paper replay barCursor boundary](project_paper-replay-barcursor-boundary.md) — chart seed (exclusive <barCursor) and live replay (start=barCursor+1ms) leave a one-bar gap at the seam.
- [AI Builder status round-trip](project_ai-builder-status-roundtrip.md) — client-only conversation statuses (e.g. "revising") get clobbered each turn by the server's narrow status set.
- [Draft<->Graph round-trip lossy](project_draft-graph-roundtrip-lossy.md) — intentional losses (entry/confirm merge, NOT skip) vs real risks (compare input ordering, fabricated SMA20).
- [validate-draft warning duplication](project_validate-draft-warning-duplication.md) — structural warnings seeded from draft.warnings + pushed undeduped; no-risk warning ignores exitConditions.
- [graph-to-draft lossy traversal](project_graph-to-draft-lossy-traversal.md) — importer: order-dependent compare source, dropped series thresholds, AND/OR flattened, multi set_risk overwritten.
