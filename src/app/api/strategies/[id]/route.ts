import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeframe, TIMEFRAMES } from "@/lib/market-data/types";

// GET /api/strategies/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }
  return NextResponse.json(strategy);
}

// PUT /api/strategies/:id
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, description, timeframe, nodes, edges } = body;

  if (timeframe !== undefined && !isTimeframe(timeframe)) {
    return NextResponse.json(
      { error: "Invalid timeframe. Must be one of: " + TIMEFRAMES.join(", ") },
      { status: 400 },
    );
  }

  const existing = await prisma.strategy.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  if (timeframe !== undefined && timeframe !== existing.timeframe) {
    const runningSession = await prisma.paperSession.findFirst({
      where: { strategyId: id, status: "running" },
      select: { id: true },
    });
    if (runningSession) {
      return NextResponse.json(
        {
          error: "Stop the active paper-trading session before changing timeframe.",
          sessionId: runningSession.id,
        },
        { status: 409 },
      );
    }
  }

  const strategy = await prisma.strategy.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(timeframe !== undefined && { timeframe }),
      ...(nodes !== undefined && { nodes }),
      ...(edges !== undefined && { edges }),
    },
  });

  return NextResponse.json(strategy);
}

// DELETE /api/strategies/:id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await prisma.strategy.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }
  await prisma.strategy.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
