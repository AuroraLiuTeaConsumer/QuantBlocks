import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/strategies/:id/paper/stop — stub
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Find the most recent running paper run for this strategy
  const run = await prisma.backtestRun.findFirst({
    where: { strategyId: id, mode: "paper", status: "running" },
    orderBy: { createdAt: "desc" },
  });

  if (!run) {
    return NextResponse.json({ error: "No running paper session found" }, { status: 404 });
  }

  await prisma.backtestRun.update({
    where: { id: run.id },
    data: { status: "completed", endTime: new Date().toISOString() },
  });

  return NextResponse.json({ runId: run.id, status: "completed", message: "Paper trading stopped (stub)" });
}
