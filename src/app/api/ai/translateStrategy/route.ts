import { NextRequest, NextResponse } from "next/server";
import { EXAMPLE_STRATEGY_NODES, EXAMPLE_STRATEGY_EDGES } from "@/lib/data/candles";

/**
 * POST /api/ai/translateStrategy
 *
 * Stub AI translator — always returns a deterministic RSI strategy graph.
 * In production this would call an LLM to translate natural language → graph JSON.
 *
 * Input:  { prompt: string, timeframe?: string }
 * Output: { strategyName, timeframe, nodes, edges, notes }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, timeframe } = body;

  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "prompt (string) is required" }, { status: 400 });
  }

  // Stub: always return a simple RSI strategy regardless of prompt
  const result = {
    strategyName: "RSI Mean-Reversion (AI Generated)",
    timeframe: timeframe ?? "1h",
    nodes: EXAMPLE_STRATEGY_NODES,
    edges: EXAMPLE_STRATEGY_EDGES,
    notes:
      "Stub translator: returns a simple RSI(14) strategy that goes long when RSI < 30 and closes when RSI > 70. " +
      `Original prompt: "${prompt}"`,
  };

  return NextResponse.json(result);
}
