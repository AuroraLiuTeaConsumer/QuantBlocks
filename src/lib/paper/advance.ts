import { prisma } from "@/lib/prisma";
import { compileGraph, step, createInitialState } from "@/lib/strategy/engine";
import type { EngineState, Bar } from "@/lib/strategy/engine";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";
import type { Prisma } from "@prisma/client";
import { recordPaperBar } from "./metrics";

export type LastBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  equity: number;
};

export type AdvanceResult =
  | {
      kind: "advanced";
      updatedAt: Date;
      barsProcessed: number;
      bars: LastBar[];
      lastBar: LastBar | null;
    }
  | { kind: "noop" }
  | { kind: "skipped"; reason: "not-running" | "lock-lost-all-retries" }
  | { kind: "skipped"; reason: "compile-error"; errors: import("@/lib/strategy/engine/types").CompileError[] };

export type AdvanceBar = {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
};

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

async function persistTrades(
  sessionId: string,
  tradesToCreate: TradeData[],
  prevPollCloses: Array<{ exitTime: Date; exitPrice: number; pnl: number }>,
): Promise<void> {
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
        ? [
            prisma.paperTrade.update({
              where: { id: prevOpenTradeId },
              data: {
                exitTime: prevPollCloses[0].exitTime,
                exitPrice: prevPollCloses[0].exitPrice,
                pnl: prevPollCloses[0].pnl,
              },
            }),
          ]
        : []),
      ...tradesToCreate.map((t) => prisma.paperTrade.create({ data: t })),
    ]);
  }
}

export async function advanceSession(
  sessionId: string,
  candidateBars: AdvanceBar[],
  maxRetries: number = 3,
): Promise<AdvanceResult> {
  if (candidateBars.length === 0) {
    return { kind: "noop" };
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const session = await prisma.paperSession.findUnique({
      where: { id: sessionId },
      include: { strategy: true },
    });

    if (!session || session.status !== "running") {
      return { kind: "skipped", reason: "not-running" };
    }

    // Guard A — cursor pre-filter
    const cursorMs = session.barCursor?.getTime() ?? -Infinity;
    const filteredBars = candidateBars
      .filter((b) => b.openTime.getTime() > cursorMs)
      .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());

    if (filteredBars.length === 0) {
      return { kind: "noop" };
    }

    const graph: StrategyGraph = {
      nodes: session.strategy.nodes as StrategyGraph["nodes"],
      edges: session.strategy.edges as StrategyGraph["edges"],
    };
    const compiled = compileGraph(graph);
    if (!compiled.ok) {
      return { kind: "skipped", reason: "compile-error", errors: compiled.errors };
    }

    let engineState: EngineState = session.engineState
      ? (session.engineState as unknown as EngineState)
      : createInitialState(session.equity);

    const tradesToCreate: TradeData[] = [];
    const prevPollCloses: Array<{ exitTime: Date; exitPrice: number; pnl: number }> = [];
    const processedBars: LastBar[] = [];
    let lastPrice = session.lastPrice;
    let lastBar: LastBar | null = null;
    let newBarCursor: Date | null = session.barCursor ?? null;

    for (const rb of filteredBars) {
      const bar: Bar = {
        timeSec: Math.floor(rb.openTime.getTime() / 1000),
        open: rb.open,
        high: rb.high,
        low: rb.low,
        close: rb.close,
      };
      newBarCursor = rb.openTime;

      const previousEquity = engineState.equity;
      const result = step(compiled.value, bar, engineState);
      engineState = result.state;
      engineState.performance = recordPaperBar(
        engineState.performance,
        engineState.initialEquity,
        previousEquity,
        engineState.equity,
        bar.close,
        result.events
          .filter((event) => event.kind === "CLOSED")
          .map((event) => event.pnl),
      );
      lastPrice = bar.close;
      lastBar = {
        time: bar.timeSec,
        open: rb.open,
        high: rb.high,
        low: rb.low,
        close: rb.close,
        equity: engineState.equity,
      };
      processedBars.push(lastBar);

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

    // Guard B — optimistic lock with status guard
    const updatedCount = await prisma.paperSession.updateMany({
      where: { id: sessionId, updatedAt: session.updatedAt, status: "running" },
      data: { ...updates, updatedAt: now },
    });

    if (updatedCount.count === 0) {
      continue;
    }

    await persistTrades(sessionId, tradesToCreate, prevPollCloses);

    return {
      kind: "advanced",
      updatedAt: now,
      barsProcessed: filteredBars.length,
      bars: processedBars,
      lastBar,
    };
  }

  return { kind: "skipped", reason: "lock-lost-all-retries" };
}
