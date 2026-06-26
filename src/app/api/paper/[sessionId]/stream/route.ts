/**
 * SSE route for paper-trading session snapshots.
 *
 * Clients connect once; the route:
 *   1. Immediately emits the current snapshot from Prisma.
 *   2. Subscribes to the Redis channel for this session.
 *   3. On every Redis nudge, re-reads Prisma and emits a fresh snapshot
 *      (Redis data is never trusted directly — except lastBar, which is
 *      ephemeral and not persisted to Prisma).
 *   4. Sends a heartbeat every 15 s so proxies/load-balancers don't close
 *      idle connections.
 *   5. Cleans up (heartbeat interval + Redis subscriber) when the client
 *      disconnects, the stream is cancelled, or the session reaches a
 *      terminal status (stopped / error).
 *
 * Runtime must be "nodejs" because ioredis uses Node.js TCP sockets.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow, SessionSnapshot } from "@/lib/paper/engine";
import { createRedisSubscriber } from "@/lib/redis/client";
import { sessionChannel } from "@/lib/redis/channels";

type LastBar = SessionSnapshot["lastBar"];

/** Encode a value as an SSE data frame. */
function sseFrame(obj: unknown): string {
  return "data: " + JSON.stringify(obj) + "\n\n";
}

/** Fetch the session row from Prisma using the minimal field set needed by toSnapshot. */
async function fetchSession(sessionId: string): Promise<SessionRow | null> {
  const row = await prisma.paperSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      strategyId: true,
      status: true,
      instrument: true,
      timeframe: true,
      lastPrice: true,
      equity: true,
      realizedPnl: true,
      unrealizedPnl: true,
      positionSide: true,
      positionQty: true,
      positionEntryPrice: true,
      useRealBars: true,
      barCursor: true,
      startedAt: true,
      updatedAt: true,
    },
  });
  return row as SessionRow | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // 404 guard — verify the session exists before opening the stream.
  const exists = await prisma.paperSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!exists) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Shared cleanup ref so both start() and cancel() can tear down the same
  // resources regardless of which path fires first.
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: unknown): void {
        try {
          controller.enqueue(new TextEncoder().encode(sseFrame(obj)));
        } catch {
          // Stream may already be closed — ignore.
        }
      }

      let sub: ReturnType<typeof createRedisSubscriber> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      function cleanup(): void {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        if (sub) { sub.disconnect(); sub = null; }
        try { controller.close(); } catch {}
        cleanupFn = null;
      }

      cleanupFn = cleanup;

      // ── 1. Emit current snapshot immediately ──────────────────────────────
      try {
        const row = await fetchSession(sessionId);
        if (row) {
          send(toSnapshot(row));
          // Session already in a terminal state — close immediately, no need
          // to open a Redis subscription or start a heartbeat.
          if (row.status !== "running") { cleanup(); return; }
        }
      } catch {
        // Transient DB error — proceed and wait for the first Redis nudge.
      }

      // ── 2. Subscribe to Redis session channel ─────────────────────────────
      try {
        sub = createRedisSubscriber();
        await sub.subscribe(sessionChannel(sessionId));
      } catch {
        // Redis unavailable — proceed without push; heartbeat keeps connection
        // alive and the client falls back to polling naturally on SSE error.
        sub = null;
      }

      // ── 3. On Redis nudge: re-read Prisma and emit snapshot ───────────────
      if (sub) {
        sub.on("message", async (_channel: string, raw: string) => {
          try {
            // lastBar is ephemeral (not stored in Prisma); extract it from the
            // nudge payload published by the paper-worker.
            let lastBar: LastBar;
            try {
              const nudge = JSON.parse(raw) as { lastBar?: LastBar };
              lastBar = nudge.lastBar;
            } catch {
              lastBar = undefined;
            }

            const row = await fetchSession(sessionId);
            if (!row) return;
            const snap = toSnapshot(row);
            send(lastBar ? { ...snap, lastBar } : snap);
            // Close stream once the session reaches a terminal status so the
            // Redis subscriber and heartbeat interval are not held indefinitely.
            if (row.status !== "running") cleanup();
          } catch {
            // Transient DB error — skip this nudge.
          }
        });
      }

      // ── 4. Heartbeat every 15 s ───────────────────────────────────────────
      heartbeatInterval = setInterval(() => {
        send({ type: "heartbeat" });
      }, 15_000);

      // ── 5. Cleanup on client disconnect ───────────────────────────────────
      req.signal.addEventListener("abort", cleanup, { once: true });
    },

    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
