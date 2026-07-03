import { prisma } from "@/lib/prisma";
import { advanceSession } from "./advance";
import type { LastBar } from "./advance";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe, TIMEFRAME_MS } from "@/lib/market-data/types";
import type { Exchange, Timeframe } from "@/lib/market-data/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives a single replay session forward at replaySpeed bars/sec until barCursor
 * reaches the live edge, then clears the replay fields and notifies 'caught-up'.
 * Exits immediately if the session stops, replaySpeed becomes null, or the
 * strategy fails to compile (replay fields are cleared in that case).
 */
export async function runReplayPump(
  sessionId: string,
  onNotify: (
    sessionId: string,
    type: string,
    lastBar?: LastBar | null,
    bars?: LastBar[],
  ) => void,
): Promise<void> {
  const repo = getTimescaleRepo();

  // Idle-tick guard: if queryCandles returns 0 rows for this many consecutive
  // ticks while the session is still behind the live edge, the data window has
  // a gap and the pump will never make progress. Give up and transition the
  // session to live mode (clear replay fields) instead of looping forever.
  const maxIdleTicks = 30;
  let idleTicks = 0;

  // Idle-poll interval used when we've consumed all available history (partial or
  // empty batch) or after a transient error — back off ~1 s and re-check for new
  // live bars rather than spinning.
  const IDLE_POLL_MS = 1000;
  // Floor on any pace sleep to guarantee forward progress can't degenerate into a
  // tight loop, even at very high replaySpeed values.
  const MIN_SLEEP_MS = 50;

  for (;;) {
    // sleepMs paces this tick. Default to the idle-poll interval so transient
    // errors and empty fetches back off rather than spin. When a batch is
    // dispatched it is recomputed below from bars-dispatched vs replaySpeed.
    let sleepMs = IDLE_POLL_MS;

    try {
      // 1. Read session; exit if not in replay mode.
      const session = await prisma.paperSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.status !== "running" || session.replaySpeed == null) {
        return;
      }

      const replaySpeed = session.replaySpeed;
      const replayUntil = session.replayUntil;

      const mapping = resolveInstrument(session.instrument);
      if (!mapping || !isTimeframe(session.timeframe)) return;
      const tf = session.timeframe as Timeframe;

      // 2. batchSize = bars to consume this tick (1 tick = 1 s)
      const batchSize = Math.max(1, Math.floor(replaySpeed));

      // 3. Fetch next batch of historical candles.
      const candles = await repo.queryCandles({
        exchange: mapping.exchange as Exchange,
        symbol: mapping.symbol,
        timeframe: tf,
        startTime: new Date((session.barCursor?.getTime() ?? 0) + 1),
        endTime: new Date(),
        limit: batchSize,
      });

      // Pace to replaySpeed bars/sec on every iteration. batchSize == the
      // clamped replaySpeed (bars consumed per 1 s), so dispatching a full batch
      // and waiting the proportional slice of a second keeps the effective rate
      // at replaySpeed. queryCandles caps at `limit == batchSize`, so a full
      // batch (candles.length == batchSize) means more history is ready — but we
      // must still pace it, not race the DB. A partial or empty batch means we've
      // consumed all available history for now; leave sleepMs at IDLE_POLL_MS so
      // we idle-poll for new live bars instead of a shorter (tighter) proportional
      // wait. Divisor batchSize is always >= 1, so no divide-by-zero.
      if (candles.length >= batchSize) {
        sleepMs = Math.max(
          MIN_SLEEP_MS,
          Math.round((candles.length / batchSize) * 1000),
        );
      }

      // 4. Advance session if there are bars to process.
      if (candles.length > 0) {
        const bars = candles.map((c) => ({
          openTime: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        const result = await advanceSession(sessionId, bars);
        if (result.kind === "advanced") {
          onNotify(sessionId, "advanced", result.lastBar, result.bars);
        } else if (result.kind === "skipped") {
          if (result.reason === "compile-error") {
            // Strategy is permanently broken — can't make progress; clear replay
            // fields so the pump exits and the worker stops respawning it.
            console.warn("[replay-pump] compile-error for", sessionId, "— clearing replay fields");
            await prisma.paperSession.updateMany({
              where: { id: sessionId, status: "running" },
              data: { replaySpeed: null, replayUntil: null },
            });
            return;
          }
          if (result.reason === "not-running") return;
          // lock-lost-all-retries: transient — fall through to sleep and retry.
        }
        // noop: cursor already at/past this batch (race with another writer) — retry next tick.
      }

      // Idle-tick tracking: reset on progress, abort after maxIdleTicks with no
      // new candles (data gap — pump cannot make forward progress).
      if (candles.length > 0) {
        idleTicks = 0;
      } else if (++idleTicks >= maxIdleTicks) {
        console.warn(
          "[replay-pump] no data for",
          maxIdleTicks,
          "consecutive ticks — giving up replay for",
          sessionId,
          "; clearing replay fields",
        );
        await prisma.paperSession.update({
          where: { id: sessionId },
          data: { replaySpeed: null, replayUntil: null },
        });
        return;
      }

      // 5. Catch-up check: compare cursor to current wall-clock time (the true live
      // edge). replayUntil != null flags that this session is in replay mode; we
      // always measure against Date.now() so the frozen session-start value doesn't
      // cause a premature transition when replay takes longer than expected.
      if (replayUntil != null) {
        const updated = await prisma.paperSession.findUnique({
          where: { id: sessionId },
          select: { status: true, barCursor: true },
        });

        if (updated && updated.status === "running") {
          const cursorMs = updated.barCursor?.getTime() ?? 0;
          const untilMs = Date.now(); // true live edge, not the frozen replayUntil value
          const tfMs = TIMEFRAME_MS[tf] ?? 0;

          if (cursorMs >= untilMs - tfMs) {
            // barCursor has reached the live edge — transition to live mode.
            await prisma.paperSession.updateMany({
              where: { id: sessionId, status: "running" },
              data: { replaySpeed: null, replayUntil: null },
            });
            onNotify(sessionId, "caught-up");
            return;
          }
        }
      }
    } catch (err) {
      console.warn(
        "[replay-pump] transient error for",
        sessionId,
        ":",
        err instanceof Error ? err.message : String(err),
      );
    }

    // 6. Pace: sleepMs was set from bars-dispatched vs replaySpeed for a full
    // batch, or left at IDLE_POLL_MS for a partial/empty batch or a transient
    // error. This throttles historical replay to replaySpeed bars/sec instead of
    // running as fast as the DB permits.
    await sleep(sleepMs);
  }
}
