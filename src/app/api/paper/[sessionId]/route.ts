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

  // ── Fetch the next batch of real candles from TimescaleDB ─────────────────
  // Returns current snapshot unchanged if the instrument is unresolvable,
  // the DB is unavailable, or the replay has caught up to the present.

  const mapping = resolveInstrument(session.instrument);
  if (!mapping) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  type RealBar = { openTime: Date; open: number; high: number; low: number; close: number };
  let realBars: RealBar[] = [];
  let newBarCursor: Date | null = session.barCursor ?? null;

  try {
    const repo = getTimescaleRepo();
    // Default cursor: 90 days before session creation, matching the default
    // ingestion window so replay starts from meaningful data.
    const sessionStart = session.startedAt ?? new Date();
    const defaultStart = new Date(sessionStart.getTime() - 90 * 24 * 3600 * 1_000);
    const cursor = newBarCursor ?? defaultStart;
    const candles = await repo.queryCandles({
      exchange: mapping.exchange,
      symbol: mapping.symbol,
      timeframe: session.timeframe as Timeframe,
      startTime: new Date(cursor.getTime() + 1), // strictly after cursor
      endTime: new Date(),
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
    // TimescaleDB unavailable — nothing to replay this poll
  }

  if (realBars.length === 0) {
    // Caught up to present or DB unavailable — return current snapshot
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // ── Step through the fetched bars ─────────────────────────────────────────
  //
  // Trade persistence (mirrors backtest.ts):
  //   OPENED → buffer a new open record (exitTime: null).
  //   CLOSED same-batch → fill in place — one DB record, no duplicate.
  //   CLOSED cross-poll → update the existing open PaperTrade row by ID.

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
  const prevPollCloses: Array<{ exitTime: Date; exitPrice: number; pnl: number }> = [];

  let lastPrice = session.lastPrice;

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
    const latest = await prisma.paperSession.findUnique({ where: { id: sessionId } });
    return NextResponse.json(toSnapshot(latest as unknown as SessionRow));
  }

  // We won the lock: persist trades. Resolve the open trade ID explicitly to
  // avoid the broad {sessionId, exitTime: null} predicate on cross-poll closes.
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
  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
