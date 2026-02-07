import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/strategies/:id/paper/start — stub
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const run = await prisma.backtestRun.create({
    data: {
      strategyId: id,
      mode: "paper",
      status: "running",
      startTime: new Date().toISOString(),
    },
  });

  return NextResponse.json({ runId: run.id, status: "running", message: "Paper trading started (stub)" });
}
