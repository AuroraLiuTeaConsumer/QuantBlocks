import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/backtests/:runId/trades
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = await prisma.backtestRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Backtest run not found" }, { status: 404 });
  }
  const trades = await prisma.trade.findMany({
    where: { runId },
    orderBy: { entryTime: "asc" },
  });
  return NextResponse.json(trades);
}
