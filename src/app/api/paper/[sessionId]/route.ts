import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { advanceSession, toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";

export async function GET(
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

  // If not running, return current snapshot without advancing
  if (session.status !== "running") {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // Pull-based simulation: advance based on elapsed time
  const now = new Date();
  const row = session as unknown as SessionRow;
  const { updates, trades } = advanceSession(row, now);

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

  // We won the lock: persist new trades, then return current session snapshot
  if (trades.length > 0) {
    await prisma.$transaction(
      trades.map((t) =>
        prisma.paperTrade.create({
          data: {
            sessionId: t.sessionId,
            side: t.side,
            qty: t.qty,
            entryTime: t.entryTime,
            entryPrice: t.entryPrice,
            exitTime: t.exitTime,
            exitPrice: t.exitPrice,
            pnl: t.pnl,
          },
        }),
      ),
    );
  }

  const updated = await prisma.paperSession.findUnique({ where: { id: sessionId } });
  return NextResponse.json(toSnapshot(updated as unknown as SessionRow));
}
