import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";

const INITIAL_EQUITY = 10_000;
const INITIAL_PRICE = 100;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Delete all trades for this session and reset fields
  const [, updated] = await prisma.$transaction([
    prisma.paperTrade.deleteMany({ where: { sessionId } }),
    prisma.paperSession.update({
      where: { id: sessionId },
      data: {
        status: "idle",
        lastPrice: INITIAL_PRICE,
        equity: INITIAL_EQUITY,
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionSide: null,
        positionQty: 0,
        positionEntryPrice: null,
        positionOpenedAt: null,
        barCursor: null,
        engineState: Prisma.DbNull,
        startedAt: null,
      },
    }),
  ]);

  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
