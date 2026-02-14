import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateGraph } from "@/lib/strategy/validator";
import { runBacktest, DEFAULT_CONFIG } from "@/lib/backtest/backtest";
import { SAMPLE_CANDLES } from "@/lib/data/candles";
import type { StrategyGraph } from "@/lib/strategy/graphTypes";

// POST /api/strategies/:id/backtests — start a backtest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const graph: StrategyGraph = {
    nodes: strategy.nodes as StrategyGraph["nodes"],
    edges: strategy.edges as StrategyGraph["edges"],
  };

  const validation = validateGraph(graph);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Invalid strategy graph", details: validation.errors },
      { status: 400 },
    );
  }

  // Parse optional config from request body
  let config = DEFAULT_CONFIG;
  try {
    const body = await req.json();
    if (body.initialCapital) config = { ...config, initialCapital: body.initialCapital };
    if (body.feeBps != null) config = { ...config, feeBps: body.feeBps };
  } catch {
    // no body or invalid JSON — use defaults
  }

  // Create the backtest run record
  const run = await prisma.backtestRun.create({
    data: {
      strategyId: id,
      mode: "backtest",
      status: "running",
      startTime: SAMPLE_CANDLES[0].time,
      endTime: SAMPLE_CANDLES[SAMPLE_CANDLES.length - 1].time,
    },
  });

  try {
    // Run backtest synchronously (MVP — small dataset)
    const result = runBacktest(graph, SAMPLE_CANDLES, config);

    // Persist trades
    for (const t of result.trades) {
      await prisma.trade.create({
        data: {
          runId: run.id,
          side: t.side,
          entryTime: t.entryTime,
          entryPrice: t.entryPrice,
          exitTime: t.exitTime,
          exitPrice: t.exitPrice,
          qty: t.qty,
          pnl: t.pnl,
          reasonOpen: t.reasonOpen,
          reasonClose: t.reasonClose ?? "N/A",
        },
      });
    }

    // Update run with results
    const updated = await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        metrics: JSON.parse(JSON.stringify(result.metrics)),
        log: JSON.parse(JSON.stringify({
          debugEvents: result.debugEvents,
          equityCurve: result.equityCurve,
          initialCapital: config.initialCapital,
        })),
      },
    });

    return NextResponse.json(updated, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: { status: "failed", log: JSON.parse(JSON.stringify({ error: message })) },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
