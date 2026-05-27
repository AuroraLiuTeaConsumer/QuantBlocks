import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { createInitialState } from "@/lib/strategy/engine";
import type { Prisma } from "@prisma/client";

const INITIAL_EQUITY = 10_000;
const INITIAL_PRICE = 100;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Optional body: { useRealBars?: boolean; replayFrom?: string (ISO date) }
  let useRealBars = false;
  let barCursor: Date | null = null;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.useRealBars === true) {
      useRealBars = true;
      if (typeof body.replayFrom === "string" && body.replayFrom) {
        const d = new Date(body.replayFrom);
        if (!isNaN(d.getTime())) barCursor = d;
      }
    }
  } catch {
    // empty / non-JSON body — use defaults
  }

  try {
    const strategy = await prisma.strategy.findUnique({ where: { id } });
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    // If there's already a running session for this strategy, return it
    const existing = await prisma.paperSession.findFirst({
      where: { strategyId: id, status: "running" },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return NextResponse.json(toSnapshot(existing as unknown as SessionRow));
    }

    const engineState = createInitialState(INITIAL_EQUITY);

    const session = await prisma.paperSession.create({
      data: {
        strategyId: id,
        status: "running",
        instrument: strategy.instrument,
        timeframe: strategy.timeframe,
        lastPrice: INITIAL_PRICE,
        equity: INITIAL_EQUITY,
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionSide: null,
        positionQty: 0,
        positionEntryPrice: null,
        useRealBars,
        barCursor,
        engineState: JSON.parse(JSON.stringify(engineState)) as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    console.error("[paper/start] Prisma error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
