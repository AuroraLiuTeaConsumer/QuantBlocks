import { PrismaClient } from "@prisma/client";
import { EXAMPLE_STRATEGY_NODES, EXAMPLE_STRATEGY_EDGES } from "../src/lib/data/candles";

const prisma = new PrismaClient();

async function main() {
  // Upsert a single example strategy
  const existing = await prisma.strategy.findFirst({ where: { name: "RSI Mean-Reversion" } });

  if (existing) {
    console.log(`Example strategy already exists (id: ${existing.id}), skipping seed.`);
    return;
  }

  const strategy = await prisma.strategy.create({
    data: {
      name: "RSI Mean-Reversion",
      description:
        "Go long when RSI(14) drops below 30, close when RSI(14) rises above 70. BTC-PERP 1h.",
      instrument: "BTC-PERP",
      timeframe: "1h",
      nodes: EXAMPLE_STRATEGY_NODES,
      edges: EXAMPLE_STRATEGY_EDGES,
    },
  });

  console.log(`Seeded example strategy: ${strategy.name} (id: ${strategy.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
