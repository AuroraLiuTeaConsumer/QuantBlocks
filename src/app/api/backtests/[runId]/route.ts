import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/backtests/:runId
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = await prisma.backtestRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "Backtest run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
