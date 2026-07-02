---
name: worker-mode-poll-split
description: Phase 4 mode='poll' vs 'worker' contract — start route + poll route auto-stop must be mode-gated; code currently contradicts docs
metadata:
  type: project
---

PaperSession.mode governs paper-trading advancement and has a two-mode contract that the code (as of investigation 2026-06-30) does NOT fully honor:
- `mode='poll'`: advanced only by client GET /api/paper/:sessionId; AUTO-STOPS when caught up to latest ingested candle.
- `mode='worker'`: advanced by paper-worker (live Redis candle fan-out + 30s catchUpSweep + replay pump); must IDLE at status='running' indefinitely, NEVER auto-stop.

**RESOLVED DIRECTION (relayed via coordinator 2026-06-30; NOT yet confirmed directly by Aurora — treat as provisional):** keep BOTH modes but make `worker` the DEFAULT; `poll` is the AUTOMATIC FALLBACK when worker mode is unavailable (Redis down at start) or the worker crashes at runtime.
- Start route: `mode = (await isRedisAvailable()) ? "worker" : "poll"`. Add `isRedisAvailable()` to src/lib/redis/client.ts (REDIS_URL present + a short-timeout PONG ping).
- Poll route (`api/paper/[sessionId]/route.ts`): advancement via `advanceSession` stays UNCONDITIONAL for all modes — this IS the crash fallback (idempotent, safe). ONLY the catch-up auto-stop block is gated to `mode === "poll"`. A worker session keeps advancing on client polls if the worker dies, but is never auto-stopped.
- replaySpeed sessions still need the worker's replay pump; with Redis down they degrade to poll-paced advancement (5 bars/poll), no accelerated replay.

**Bugs being fixed (current code):**
- `paper/start/route.ts` hardcodes `mode: "worker"` for ALL sessions (ignores Redis availability) — replace with the isRedisAvailable() decision above.
- `api/paper/[sessionId]/route.ts` GET auto-stops ANY caught-up session with no mode check — gate auto-stop to poll mode only.

**Runtime prereq, easy to miss:** worker calls `createRedisSubscriber()` at MODULE LOAD — it throws if REDIS_URL unset, crashing `npm run paper:worker`. REDIS_URL was absent from .env/.env.example and there was no Redis service in docker-compose. Live path also needs `npm run ws:ingest` running.

Builds on [[advance-idempotency-design]] (advance.ts is the shared correctness core, unaffected) and [[project-constraints]] (migration via raw SQL + resolve, never migrate dev).
