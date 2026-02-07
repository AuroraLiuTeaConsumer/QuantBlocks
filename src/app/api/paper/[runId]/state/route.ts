import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/paper/:runId/state — stub
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = await prisma.backtestRun.findUnique({
    where: { id: runId },
    include: { trades: { orderBy: { entryTime: "desc" }, take: 10 } },
  });

  if (!run || run.mode !== "paper") {
    return NextResponse.json({ error: "Paper run not found" }, { status: 404 });
  }

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    position: null, // stub — no live position tracking yet
    lastSignal: null,
    recentTrades: run.trades,
  });
}
