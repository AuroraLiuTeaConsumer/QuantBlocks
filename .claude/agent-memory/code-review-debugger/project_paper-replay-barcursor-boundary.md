---
name: paper-replay-barcursor-boundary
description: barCursor seam between chart seed fetch and live replay fetch uses mismatched inclusive/exclusive bounds — fence-post gap risk
metadata:
  type: project
---

Paper trading replay has a fragile boundary at `barCursor` (the replay-start timestamp persisted at session creation in `src/app/api/strategies/[id]/paper/start/route.ts`).

Two fetches meet at `barCursor` with **different bound conventions**, which is the recurring footgun:
- Chart seed: `GET /api/strategies/[id]/bars?end=<barCursor>` → `endTime = barCursor`, SQL `open_time < endTime` (exclusive upper). See `timescale.repo.ts` queryCandles bounds: `open_time >= start AND open_time < end`.
- Live replay poll: `src/app/api/paper/[sessionId]/route.ts` → `startTime = barCursor + 1ms`, SQL `open_time >= start` (so first live bar is strictly > barCursor).

Result: the candle whose `open_time == barCursor` is fetched by neither side → a one-bar gap exactly at the join, visible as a price jump. Fix is to make the live fetch inclusive (`startTime = cursor`, not `cursor+1ms`) so the seed (`< barCursor`) and live (`>= barCursor`) tile without gap/overlap.

**Why:** introduced by commit bddc4d2 (Jun 2026) when seed `end` was anchored to barCursor.
**How to apply:** any time you touch the seed window or the replay cursor math, verify seed-end and live-start tile exactly — seed exclusive-below barCursor, live inclusive-at barCursor. Related second defect: `paper/start` seeds `lastPrice` from the *newest* DB candle (getLatestOpenTime), not the candle at barCursor, so the start-snapshot synthetic candle in `PaperTradingPanel.appendFromSnapshot` carries a wrong-era price at the seam.
