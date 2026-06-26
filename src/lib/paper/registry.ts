import { prisma } from "@/lib/prisma";
import { resolveInstrument } from "@/lib/market-data/types";

export async function getActiveSessions(
  exchange: string,
  symbol: string,
  timeframe: string,
): Promise<string[]> {
  const sessions = await prisma.paperSession.findMany({
    where: { status: "running" },
  });

  return sessions
    .filter((s) => {
      // TODO(post-migrate): add mode: "worker" to findMany where clause above
      if ((s as any).mode !== "worker") return false;
      if (s.timeframe !== timeframe) return false;
      const mapping = resolveInstrument(s.instrument);
      if (!mapping) return false;
      return mapping.exchange === exchange && mapping.symbol === symbol;
    })
    .map((s) => s.id);
}

export async function getWorkerSubscriptions(): Promise<
  Array<{ exchange: string; symbol: string; timeframe: string }>
> {
  const sessions = await prisma.paperSession.findMany({
    where: { status: "running" },
  });

  const seen = new Set<string>();
  const result: Array<{ exchange: string; symbol: string; timeframe: string }> = [];

  for (const s of sessions) {
    // TODO(post-migrate): add mode: "worker" to findMany where clause above
    if ((s as any).mode !== "worker") continue;
    const mapping = resolveInstrument(s.instrument);
    if (!mapping) continue;
    const key = `${mapping.exchange}:${mapping.symbol}:${s.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ exchange: mapping.exchange, symbol: mapping.symbol, timeframe: s.timeframe });
  }

  return result;
}
