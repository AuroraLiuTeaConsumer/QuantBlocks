import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { compileGraph, step, createInitialState } from "@/lib/strategy/engine";
import type { EngineState, Bar } from "@/lib/strategy/engine";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import type { Prisma } from "@prisma/client";

/**
 * Generate a simulated bar using random-walk from the last known price.
 * This is a placeholder until real market data feeds are integrated.
 */
function simulateBar(lastPrice: number, timeSec: number): Bar {
  const change = (Math.random() - 0.5) * 2 * lastPrice * 0.005; // ±0.5%
  const close = Math.round((lastPrice + change) * 100) / 100;
  const high = Math.max(lastPrice, close) + Math.random() * lastPrice * 0.002;
  const low = Math.min(lastPrice, close) - Math.random() * lastPrice * 0.002;
  return {
    timeSec,
    open: lastPrice,
    high: Math.round(high * 100) / 100,
    low: Math.round(low * 100) / 100,
    close,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
    include: { strategy: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If not running, return current snapshot without advancing
  if (session.status !== "running") {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // Compile the strategy graph
  const graph: StrategyGraph = {
    nodes: session.strategy.nodes as StrategyGraph["nodes"],
    edges: session.strategy.edges as StrategyGraph["edges"],
  };
  const compiled = compileGraph(graph);
  if (!compiled.ok) {
    return NextResponse.json(
      { error: "Strategy compilation failed", details: compiled.errors },
      { status: 500 },
    );
  }

  // Restore engine state from DB or create fresh
  let engineState: EngineState = session.engineState
    ? (session.engineState as unknown as EngineState)
    : createInitialState(session.equity);

  // Determine how many bars to simulate based on elapsed time
  const now = new Date();
  const lastUpdate = session.updatedAt;
  const elapsedMs = now.getTime() - lastUpdate.getTime();
  const barIntervalMs = parseTimeframeMs(session.timeframe);
  const barsToSim = Math.min(Math.floor(elapsedMs / barIntervalMs), 10); // cap at 10 bars per poll

  if (barsToSim === 0) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // Step through bars
  const newTrades: Array<{
    sessionId: string;
    side: string;
    qty: number;
    entryTime: Date;
    entryPrice: number;
    exitTime: Date | null;
    exitPrice: number | null;
    pnl: number;
  }> = [];

  let lastPrice = session.lastPrice;
  let currentTimeSec = Math.floor(lastUpdate.getTime() / 1000);

  for (let i = 0; i < barsToSim; i++) {
    currentTimeSec += Math.floor(barIntervalMs / 1000);
    const bar = simulateBar(lastPrice, currentTimeSec);
    const result = step(compiled.value, bar, engineState);
    engineState = result.state;
    lastPrice = bar.close;

    // Convert trade events to DB records
    for (const evt of result.events) {
      if (evt.kind === "OPENED") {
        newTrades.push({
          sessionId,
          side: evt.side,
          qty: evt.qty,
          entryTime: new Date(evt.timeSec * 1000),
          entryPrice: evt.entryPrice,
          exitTime: null,
          exitPrice: null,
          pnl: 0,
        });
      } else if (evt.kind === "CLOSED") {
        newTrades.push({
          sessionId,
          side: evt.side,
          qty: evt.qty,
          entryTime: new Date(evt.entryTimeSec * 1000),
          entryPrice: evt.entryPrice,
          exitTime: new Date(evt.timeSec * 1000),
          exitPrice: evt.exitPrice,
          pnl: evt.pnl,
        });
      }
    }
  }

  // Compute unrealized PnL from engine state
  let unrealizedPnl = 0;
  if (engineState.position) {
    const diff = lastPrice - engineState.position.entryPrice;
    const dir = engineState.position.side === "long" ? 1 : -1;
    unrealizedPnl = Math.round(diff * dir * engineState.position.qty * 10000) / 10000;
  }

  // Build session updates
  const updates = {
    lastPrice,
    equity: engineState.equity,
    realizedPnl: engineState.realizedPnl,
    unrealizedPnl,
    positionSide: engineState.position?.side ?? null,
    positionQty: engineState.position?.qty ?? 0,
    positionEntryPrice: engineState.position?.entryPrice ?? null,
    positionOpenedAt: engineState.position
      ? new Date(engineState.position.entryTimeSec * 1000)
      : null,
    engineState: JSON.parse(JSON.stringify(engineState)) as Prisma.InputJsonValue,
  };

  // Optimistic lock: only update if nobody else advanced the session
  const prevUpdatedAt = session.updatedAt;
  const updatedCount = await prisma.paperSession.updateMany({
    where: { id: sessionId, updatedAt: prevUpdatedAt },
    data: { ...updates, updatedAt: now },
  });

  if (updatedCount.count === 0) {
    // Another poll already advanced it; return latest snapshot
    const latest = await prisma.paperSession.findUnique({ where: { id: sessionId } });
    return NextResponse.json(toSnapshot(latest as unknown as SessionRow));
  }

  // We won the lock: persist new trades
  if (newTrades.length > 0) {
    await prisma.$transaction(
      newTrades.map((t) =>
        prisma.paperTrade.create({ data: t }),
      ),
    );
  }

  const updated = await prisma.paperSession.findUnique({ where: { id: sessionId } });
  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}

// ── Helpers ──────────────────────────────────────────────────

function parseTimeframeMs(tf: string): number {
  const match = tf.match(/^(\d+)(m|h|d)$/);
  if (!match) return 60_000; // default 1m
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: return 60_000;
  }
}
