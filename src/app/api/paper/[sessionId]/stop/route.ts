import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { forceClose } from "@/lib/strategy/engine";
import type { EngineState, Bar } from "@/lib/strategy/engine";
import type { Prisma } from "@prisma/client";

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

  if (session.status !== "running") {
    return NextResponse.json(
      { error: `Cannot stop session with status "${session.status}"` },
      { status: 400 },
    );
  }

  // Force-close any open position via the engine
  const engineState = session.engineState as unknown as EngineState | null;
  let updateData: Record<string, unknown> = { status: "stopped" };

  if (engineState?.position) {
    const bar: Bar = {
      timeSec: Math.floor(Date.now() / 1000),
      open: session.lastPrice,
      high: session.lastPrice,
      low: session.lastPrice,
      close: session.lastPrice,
    };
    const { state: closedState, event } = forceClose(engineState, bar);

    updateData = {
      status: "stopped",
      equity: closedState.equity,
      realizedPnl: closedState.realizedPnl,
      unrealizedPnl: 0,
      positionSide: null,
      positionQty: 0,
      positionEntryPrice: null,
      positionOpenedAt: null,
      engineState: JSON.parse(JSON.stringify(closedState)) as Prisma.InputJsonValue,
    };

    // Update the existing open PaperTrade record with exit data.
    // forceClose always closes a position that was opened in a previous poll,
    // so the open record already exists in DB (exitTime IS NULL). We update it
    // in place rather than creating a duplicate closed record.
    if (event && event.kind === "CLOSED") {
      await prisma.paperTrade.updateMany({
        where: { sessionId, exitTime: null },
        data: {
          exitTime: new Date(event.timeSec * 1000),
          exitPrice: event.exitPrice,
          pnl: event.pnl,
        },
      });
    }
  }

  const updated = await prisma.paperSession.update({
    where: { id: sessionId },
    data: updateData,
  });

  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
