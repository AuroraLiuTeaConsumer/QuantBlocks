import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StrategyWorkspace } from "@/components/strategy/StrategyWorkspace";

export const dynamic = "force-dynamic";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const strategy = await prisma.strategy.findUnique({ where: { id } });

  if (!strategy) notFound();

  return (
    <StrategyWorkspace
      strategy={{
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        instrument: strategy.instrument,
        timeframe: strategy.timeframe,
        nodes: strategy.nodes,
        edges: strategy.edges,
      }}
    />
  );
}
