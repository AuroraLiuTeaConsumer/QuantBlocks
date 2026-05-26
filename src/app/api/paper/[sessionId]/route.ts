import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { compileGraph, step, createInitialState } from "@/lib/strategy/engine";
import type { EngineState, Bar } from "@/lib/strategy/engine";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import type { Prisma } from "@prisma/client";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";

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

  const now = new Date();
  const lastUpdate = session.updatedAt;
  const barIntervalMs = parseTimeframeMs(session.timeframe);

  // ── Determine bars to process this poll ───────────────────────────────────
  // Real-bar mode: fetch the next N closed candles from TimescaleDB starting
  //   from barCursor. One bar per poll so the UI updates smoothly.
  // Synthetic mode: derive N bars from elapsed wall-clock time.

  type RealBar = { openTime: Date; open: number; high: number; low: number; close: number };
  let realBars: RealBar[] = [];
  let newBarCursor: Date | null = session.barCursor ?? null;

  if (session.useRealBars) {
    const mapping = resolveInstrument(session.instrument);
    if (mapping) {
      try {
        const repo = getTimescaleRepo();
        // When no cursor yet, start from 90 days before session creation —
        // matching the default ingestion window rather than querying from epoch.
        const sessionStart = session.startedAt ?? new Date();
        const defaultStart = new Date(sessionStart.getTime() - 90 * 24 * 3600 * 1_000);
        const cursor = newBarCursor ?? defaultStart;
        const candles = await repo.queryCandles({
          exchange: mapping.exchange,
          symbol: mapping.symbol,
          timeframe: session.timeframe as Timeframe,
          startTime: new Date(cursor.getTime() + 1), // strictly after cursor
          endTime: new Date(Date.now() + barIntervalMs),
          limit: 5, // at most 5 bars per poll; keeps replay at a reasonable pace
        });
        realBars = candles.map((c) => ({
          openTime: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
      } catch {
        // TimescaleDB unavailable — fall through to synthetic
      }
    }

    if (realBars.length === 0) {
      // No new candles available yet (caught up or DB unavailable)
      return NextResponse.json(toSnapshot(session as unknown as SessionRow));
    }
  }

  const barsToSim = session.useRealBars
    ? realBars.length
    : Math.min(Math.floor((now.getTime() - lastUpdate.getTime()) / barIntervalMs), 10);

  if (barsToSim === 0) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // Step through bars
  //
  // Trade persistence strategy (mirrors backtest.ts lines 163-171):
  //   OPENED → buffer a new open record (exitTime: null).
  //   CLOSED → first check if the matching open is in the current buffer
  //            (same poll batch). If so, fill it in place — one complete record,
  //            no duplicate. If not (position was opened in a previous poll),
  //            queue a DB update for the existing open PaperTrade row.
  type TradeData = {
    sessionId: string;
    side: string;
    qty: number;
    entryTime: Date;
    entryPrice: number;
    exitTime: Date | null;
    exitPrice: number | null;
    pnl: number;
  };

  const tradesToCreate: TradeData[] = [];
  // Exit data for positions opened in a previous poll (update existing DB row)
  const prevPollCloses: Array<{ exitTime: Date; exitPrice: number; pnl: number }> = [];

  let lastPrice = session.lastPrice;
  let currentTimeSec = Math.floor(lastUpdate.getTime() / 1000);

  for (let i = 0; i < barsToSim; i++) {
    let bar: Bar;
    if (session.useRealBars && realBars[i]) {
      const rb = realBars[i];
      bar = {
        timeSec: Math.floor(rb.openTime.getTime() / 1000),
        open: rb.open,
        high: rb.high,
        low: rb.low,
        close: rb.close,
      };
      newBarCursor = rb.openTime;
    } else {
      currentTimeSec += Math.floor(barIntervalMs / 1000);
      bar = simulateBar(lastPrice, currentTimeSec);
    }
    const result = step(compiled.value, bar, engineState);
    engineState = result.state;
    lastPrice = bar.close;

    for (const evt of result.events) {
      if (evt.kind === "OPENED") {
        tradesToCreate.push({
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
        // Look for the matching open trade in the current batch first
        const openIdx = tradesToCreate.findLastIndex((t) => t.exitTime === null);
        if (openIdx >= 0) {
          // Same-batch open+close: fill exit fields in place → single DB record
          tradesToCreate[openIdx] = {
            ...tradesToCreate[openIdx],
            exitTime: new Date(evt.timeSec * 1000),
            exitPrice: evt.exitPrice,
            pnl: evt.pnl,
          };
        } else {
          // Position was opened in a previous poll — update the existing DB row
          prevPollCloses.push({
            exitTime: new Date(evt.timeSec * 1000),
            exitPrice: evt.exitPrice,
            pnl: evt.pnl,
          });
        }
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
    ...(newBarCursor !== null ? { barCursor: newBarCursor } : {}),
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

  // We won the lock: persist trades
  if (tradesToCreate.length > 0 || prevPollCloses.length > 0) {
    await prisma.$transaction([
      // New records (opens, or same-batch open+close)
      ...tradesToCreate.map((t) => prisma.paperTrade.create({ data: t })),
      // Close the open record from a previous poll — update by sessionId + exitTime IS NULL.
      // updateMany is safe here: a single-instrument engine can hold at most one open
      // position at a time, so at most one row matches the predicate per close event.
      ...prevPollCloses.map((c) =>
        prisma.paperTrade.updateMany({
          where: { sessionId, exitTime: null },
          data: { exitTime: c.exitTime, exitPrice: c.exitPrice, pnl: c.pnl },
        }),
      ),
    ]);
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
