---
name: replay-pump-liveedge
description: runReplayPump replays historical candles at replaySpeed bars/sec; replayUntil pins the live edge but is captured at start time and never advances.
metadata:
  type: project
---

`src/lib/paper/replay.ts` (`runReplayPump`) drives accelerated paper replay. Worker (`paper-worker.job.ts`) spawns one pump per session via `syncReplayPumps`, tracked in `activePumps` Map.

Key contract details:
- `replayUntil` is set ONCE at start (`new Date()` in start/route.ts) and never moved forward. So the pump's catch-up target is frozen at session-start wall-clock, not the true current live edge.
- Catch-up condition: `cursorMs >= untilMs - tfMs`. When met it nulls `replaySpeed`/`replayUntil` and notifies `caught-up`, then real-time WS bars take over via the message handler.
- `queryCandles` endTime is exclusive (`open_time < $5`) and ordered ASC with LIMIT — replay batch is the oldest unprocessed bars after barCursor.

**Why:** accelerated replay lets a user fast-forward from a past replayFrom date up to "now", then seamlessly continue live.

**How to apply:** when reviewing replay seam/gap issues, check the [[project_paper-replay-barcursor-boundary]] one-bar-gap interaction and whether replayUntil staleness causes early/late handoff to live mode.
