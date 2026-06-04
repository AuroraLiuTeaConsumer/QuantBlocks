import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { compileGraph, step, createInitialState } from "@/lib/strategy/engine";
import type { EngineState, Bar } from "@/lib/strategy/engine";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import type { Prisma } from "@prisma/client";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";

const MAX_RETRIES = 3;

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

  if (session.status !== "running") {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // ── One-time setup (stable across retry attempts) ────────────────────────

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

  const mapping = resolveInstrument(session.instrument);
  if (!mapping) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  if (!isTimeframe(session.timeframe)) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }
  const timeframe = session.timeframe as Timeframe;

  // Local types used in every attempt
  type RealBar = { openTime: Date; open: number; high: number; low: number; close: number };
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

  // `cur` holds the freshest session row; re-fetched on each retry so the
  // optimistic lock reads the latest `updatedAt` and the bar cursor is correct.
  type SessionWithStrategy = typeof session;
  let cur: SessionWithStrategy = session;

  // ── Retry loop ────────────────────────────────────────────────────────────
  //
  // A collision (two concurrent polls) causes the loser's updateMany to match
  // 0 rows. Rather than silently discarding the work, re-fetch the session
  // (which now reflects the winner's cursor) and try again with the next batch.

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Re-fetch so we see the updated barCursor, engineState, and updatedAt.
      const refreshed = await prisma.paperSession.findUnique({
        where: { id: sessionId },
        include: { strategy: true },
      });
      if (!refreshed) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (refreshed.status !== "running") {
        // Session was stopped or reset by another request between attempts.
        return NextResponse.json(toSnapshot(refreshed as unknown as SessionRow));
      }
      cur = refreshed;
    }

    // Restore engine state from the current session row
    let engineState: EngineState = cur.engineState
      ? (cur.engineState as unknown as EngineState)
      : createInitialState(cur.equity);

    // ── Fetch the next batch of real candles ────────────────────────────────
    let realBars: RealBar[] = [];
    let newBarCursor: Date | null = cur.barCursor ?? null;

    try {
      const repo = getTimescaleRepo();
      const sessionStart = cur.startedAt ?? new Date();
      const defaultStart = new Date(sessionStart.getTime() - 90 * 24 * 3600 * 1_000);
      const cursor = newBarCursor ?? defaultStart;
      const candles = await repo.queryCandles({
        exchange: mapping.exchange,
        symbol: mapping.symbol,
        timeframe,
        startTime: new Date(cursor.getTime() + 1),
        endTime: new Date(),
        limit: 5,
      });
      realBars = candles.map((c) => ({
        openTime: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
    } catch {
      // TimescaleDB unavailable — nothing to replay this poll
    }

    if (realBars.length === 0) {
      return NextResponse.json(toSnapshot(cur as unknown as SessionRow));
    }

    // ── Step through the fetched bars ───────────────────────────────────────
    //
    // Trade persistence (mirrors backtest.ts):
    //   OPENED → buffer open record (exitTime: null).
    //   CLOSED same-batch → fill in place — one DB record, no duplicate.
    //   CLOSED cross-poll → update the existing open PaperTrade row by ID.

    const tradesToCreate: TradeData[] = [];
    const prevPollCloses: Array<{ exitTime: Date; exitPrice: number; pnl: number }> = [];
    let lastPrice = cur.lastPrice;

    for (const rb of realBars) {
      const bar: Bar = {
        timeSec: Math.floor(rb.openTime.getTime() / 1000),
        open: rb.open,
        high: rb.high,
        low: rb.low,
        close: rb.close,
      };
      newBarCursor = rb.openTime;

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
          const openIdx = tradesToCreate.findLastIndex((t) => t.exitTime === null);
          if (openIdx >= 0) {
            tradesToCreate[openIdx] = {
              ...tradesToCreate[openIdx],
              exitTime: new Date(evt.timeSec * 1000),
              exitPrice: evt.exitPrice,
              pnl: evt.pnl,
            };
          } else {
            prevPollCloses.push({
              exitTime: new Date(evt.timeSec * 1000),
              exitPrice: evt.exitPrice,
              pnl: evt.pnl,
            });
          }
        }
      }
    }

    // ── Compute unrealized PnL + build update payload ───────────────────────

    let unrealizedPnl = 0;
    if (engineState.position) {
      const diff = lastPrice - engineState.position.entryPrice;
      const dir = engineState.position.side === "long" ? 1 : -1;
      unrealizedPnl = Math.round(diff * dir * engineState.position.qty * 10000) / 10000;
    }

    const now = new Date();
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

    // ── Optimistic lock attempt ─────────────────────────────────────────────

    const prevUpdatedAt = cur.updatedAt;
    const updatedCount = await prisma.paperSession.updateMany({
      where: { id: sessionId, updatedAt: prevUpdatedAt },
      data: { ...updates, updatedAt: now },
    });

    if (updatedCount.count === 0) {
      // Another poll won the lock — loop to retry with the refreshed session.
      continue;
    }

    // ── Won the lock: persist trades ────────────────────────────────────────
    // Resolve the open trade ID explicitly to avoid the broad
    // {sessionId, exitTime: null} predicate on cross-poll closes.

    let prevOpenTradeId: string | null = null;
    if (prevPollCloses.length > 0) {
      const open = await prisma.paperTrade.findFirst({
        where: { sessionId, exitTime: null },
        select: { id: true },
      });
      prevOpenTradeId = open?.id ?? null;
    }

    if (tradesToCreate.length > 0 || (prevPollCloses.length > 0 && prevOpenTradeId != null)) {
      await prisma.$transaction([
        ...(prevPollCloses.length > 0 && prevOpenTradeId != null
          ? [prisma.paperTrade.update({
              where: { id: prevOpenTradeId },
              data: {
                exitTime: prevPollCloses[0].exitTime,
                exitPrice: prevPollCloses[0].exitPrice,
                pnl: prevPollCloses[0].pnl,
              },
            })]
          : []),
        ...tradesToCreate.map((t) => prisma.paperTrade.create({ data: t })),
      ]);
    }

    const updated = await prisma.paperSession.findUnique({ where: { id: sessionId } });
    if (!updated) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
  }

  // ── All retries exhausted ─────────────────────────────────────────────────
  // Return the latest DB state; the client will retry on the next poll interval.

  return NextResponse.json(toSnapshot(cur as unknown as SessionRow));
}
