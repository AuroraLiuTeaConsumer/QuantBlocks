import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });

  if (!strategy) notFound();

  const nodes = strategy.nodes as unknown[];
  const edges = strategy.edges as unknown[];

  return (
    <main className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{strategy.name}</h1>
        <Link
          href="/strategies"
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          &larr; Back
        </Link>
      </div>

      <div className="text-sm text-gray-500 mb-6">
        {strategy.instrument} &middot; {strategy.timeframe}
        {strategy.description && <span> &middot; {strategy.description}</span>}
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Nodes ({nodes.length})</h2>
        <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs overflow-auto max-h-64">
          {JSON.stringify(nodes, null, 2)}
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Edges ({edges.length})</h2>
        <pre className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs overflow-auto max-h-64">
          {JSON.stringify(edges, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Actions</h2>
        <p className="text-sm text-gray-500 mb-3">
          Use the API to run a backtest:{" "}
          <code className="bg-gray-900 px-2 py-0.5 rounded text-xs">
            POST /api/strategies/{strategy.id}/backtests
          </code>
        </p>
        <RunBacktestButton strategyId={strategy.id} />
      </section>
    </main>
  );
}

function RunBacktestButton({ strategyId }: { strategyId: string }) {
  return (
    <form
      action={async () => {
        "use server";
        // Server action: trigger backtest via internal import
        const { prisma: db } = await import("@/lib/prisma");
        const { runBacktest } = await import("@/lib/backtest/backtest");
        const { SAMPLE_CANDLES } = await import("@/lib/data/candles");
        const { DEFAULT_CONFIG } = await import("@/lib/backtest/backtest");

        const strategy = await db.strategy.findUnique({ where: { id: strategyId } });
        if (!strategy) return;

        const graph = {
          nodes: strategy.nodes as { id: string; type: "price" | "volume" | "rsi" | "compare" | "cross" | "and" | "or" | "not" | "constant" | "open_position" | "close_position" | "set_risk"; position: { x: number; y: number }; data: Record<string, unknown> }[],
          edges: strategy.edges as { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; type?: string }[],
        };

        const result = runBacktest(graph, SAMPLE_CANDLES, DEFAULT_CONFIG);

        const run = await db.backtestRun.create({
          data: {
            strategyId,
            mode: "backtest",
            status: "completed",
            startTime: SAMPLE_CANDLES[0].time,
            endTime: SAMPLE_CANDLES[SAMPLE_CANDLES.length - 1].time,
            metrics: JSON.parse(JSON.stringify(result.metrics)),
            log: JSON.parse(JSON.stringify({
              debugEvents: result.debugEvents,
              equityCurve: result.equityCurve,
            })),
          },
        });

        for (const t of result.trades) {
          await db.trade.create({
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
      }}
    >
      <button
        type="submit"
        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-colors"
      >
        Run Backtest
      </button>
    </form>
  );
}
