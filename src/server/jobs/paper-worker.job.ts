#!/usr/bin/env tsx

// Load .env before any imports that read process.env
import "./load-env";

import { prisma } from "../../lib/prisma";
import { getRedisPublisher, createRedisSubscriber } from "../../lib/redis/client";
import { candleChannel, sessionChannel, decodeCandleMsg } from "../../lib/redis/channels";
import { getActiveSessions, getWorkerSubscriptions } from "../../lib/paper/registry";
import { advanceSession } from "../../lib/paper/advance";
import type { LastBar } from "../../lib/paper/advance";
import { getTimescaleRepo } from "../../lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe } from "../../lib/market-data/types";
import type { Exchange, Timeframe } from "../../lib/market-data/types";

const CATCH_UP_LIMIT = 50;

const subscriber = createRedisSubscriber();
const publisher = getRedisPublisher();

const subscribedChannels = new Set<string>();

// Tracks in-flight advanceSession calls so shutdown can drain them.
let inFlight = 0;
let drainResolve: (() => void) | null = null;

function trackStart(): void { inFlight++; }
function trackEnd(): void {
  inFlight--;
  if (inFlight === 0 && drainResolve) {
    drainResolve();
    drainResolve = null;
  }
}
function drainInFlight(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => { drainResolve = resolve; });
}

function publishAdvanced(sessionId: string, updatedAt: Date, lastBar: LastBar | null): void {
  publisher
    .publish(
      sessionChannel(sessionId),
      JSON.stringify({ v: 1, type: "advanced", updatedAt, lastBar }),
    )
    .catch((err: unknown) => {
      console.warn("[paper-worker] publish error:", err instanceof Error ? err.message : String(err));
    });
}

async function syncSubscriptions(): Promise<void> {
  let subs: Array<{ exchange: string; symbol: string; timeframe: string }>;
  try {
    subs = await getWorkerSubscriptions();
  } catch (err) {
    console.warn("[paper-worker] syncSubscriptions error:", err instanceof Error ? err.message : String(err));
    return;
  }

  const desired = new Set(subs.map((s) => candleChannel(s.exchange, s.symbol, s.timeframe)));

  const toAdd = [...desired].filter((ch) => !subscribedChannels.has(ch));
  const toRemove = [...subscribedChannels].filter((ch) => !desired.has(ch));

  if (toAdd.length > 0) {
    await subscriber.subscribe(...toAdd);
    for (const ch of toAdd) subscribedChannels.add(ch);
    console.log("[paper-worker] subscribed:", toAdd);
  }

  if (toRemove.length > 0) {
    await subscriber.unsubscribe(...toRemove);
    for (const ch of toRemove) subscribedChannels.delete(ch);
    console.log("[paper-worker] unsubscribed:", toRemove);
  }
}

subscriber.on("message", async (_channel: string, raw: string) => {
  try {
    const msg = decodeCandleMsg(raw);
    if (!msg) return;

    const { exchange, symbol, timeframe } = msg;
    const sessionIds = await getActiveSessions(exchange, symbol, timeframe);

    const bar = {
      openTime: new Date(msg.openTime),
      open: msg.open,
      high: msg.high,
      low: msg.low,
      close: msg.close,
    };

    for (const sessionId of sessionIds) {
      trackStart();
      try {
        // advanceSession is the single source of truth for concurrency — the
        // sweep and this handler may race the same session; the optimistic lock
        // in advanceSession ensures only one writer wins per bar.
        const result = await advanceSession(sessionId, [bar]);
        if (result.kind === "advanced") {
          publishAdvanced(sessionId, result.updatedAt, result.lastBar);
        }
      } catch (err) {
        console.warn("[paper-worker] advanceSession error for", sessionId, ":", err instanceof Error ? err.message : String(err));
      } finally {
        trackEnd();
      }
    }
  } catch (err) {
    console.warn("[paper-worker] message handler error:", err instanceof Error ? err.message : String(err));
  }
});

async function catchUpSweep(): Promise<void> {
  let sessions: Awaited<ReturnType<typeof prisma.paperSession.findMany>>;
  try {
    sessions = await prisma.paperSession.findMany({
      where: { status: "running" },
    });
  } catch (err) {
    console.warn("[paper-worker] catchUpSweep query error:", err instanceof Error ? err.message : String(err));
    return;
  }

  const repo = getTimescaleRepo();

  for (const session of sessions) {
    // TODO(post-migrate): push mode: "worker" into the findMany where clause above
    // and remove this cast once prisma generate is re-run against the new schema.
    if ((session as any).mode !== "worker") continue;

    try {
      const mapping = resolveInstrument(session.instrument);
      if (!mapping) continue;

      if (!isTimeframe(session.timeframe)) continue;

      const candles = await repo.queryCandles({
        exchange: mapping.exchange as Exchange,
        symbol: mapping.symbol,
        timeframe: session.timeframe as Timeframe,
        startTime: new Date((session.barCursor?.getTime() ?? 0) + 1),
        endTime: new Date(),
        limit: CATCH_UP_LIMIT,
      });

      if (candles.length === 0) {
        continue;
      }

      if (candles.length === CATCH_UP_LIMIT) {
        console.log(`[paper-worker] session ${session.id} is catching up (${CATCH_UP_LIMIT} bars fetched, more pending)`);
      }

      const bars = candles.map((c) => ({
        openTime: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      trackStart();
      try {
        const result = await advanceSession(session.id, bars);
        if (result.kind === "advanced") {
          publishAdvanced(session.id, result.updatedAt);
        }
      } finally {
        trackEnd();
      }
    } catch (err) {
      console.warn("[paper-worker] catchUpSweep session error", session.id, ":", err instanceof Error ? err.message : String(err));
    }
  }
}

void syncSubscriptions();
const syncInterval = setInterval(() => { void syncSubscriptions(); }, 10_000);

void catchUpSweep();
const sweepInterval = setInterval(() => { void catchUpSweep(); }, 30_000);

async function shutdown(): Promise<void> {
  clearInterval(syncInterval);
  clearInterval(sweepInterval);
  await drainInFlight();
  await subscriber.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });

console.log("[paper-worker] started");
