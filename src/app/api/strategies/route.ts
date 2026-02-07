import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateGraph } from "@/lib/strategy/validator";

// POST /api/strategies — create strategy
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, timeframe, nodes, edges } = body;

  if (!name || !nodes || !edges) {
    return NextResponse.json({ error: "name, nodes, edges are required" }, { status: 400 });
  }

  const validation = validateGraph({ nodes, edges });
  if (!validation.valid) {
    return NextResponse.json({ error: "Invalid graph", details: validation.errors }, { status: 400 });
  }

  const strategy = await prisma.strategy.create({
    data: {
      name,
      description: description ?? null,
      instrument: "BTC-PERP",
      timeframe: timeframe ?? "1h",
      nodes,
      edges,
    },
  });

  return NextResponse.json(strategy, { status: 201 });
}

// GET /api/strategies — list all strategies
export async function GET() {
  const strategies = await prisma.strategy.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(strategies);
}
