import { prisma } from "@/lib/prisma";
import { resolveInstrument } from "@/lib/market-data/types";

export async function getActiveSessions(
  exchange: string,
  symbol: string,
  timeframe: string,
): Promise<string[]> {
  // replaySpeed == null means live mode. Sessions still in accelerated replay
  // (replaySpeed != null) are driven forward bar-by-bar by their replay pump;
  // they must be excluded from live-candle dispatch, otherwise a live candle
  // would advance barCursor straight to the live edge and skip all pending
  // historical bars. Once the pump catches up it clears replaySpeed, at which
  // point the session re-enters this live path (and catchUpSweep covers any gap).
  const sessions = await prisma.paperSession.findMany({
    where: { status: "running", mode: "worker", replaySpeed: null },
  });

  return sessions
    .filter((s) => {
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
    where: { status: "running", mode: "worker" },
  });

  const seen = new Set<string>();
  const result: Array<{ exchange: string; symbol: string; timeframe: string }> = [];

  for (const s of sessions) {
    const mapping = resolveInstrument(s.instrument);
    if (!mapping) continue;
    const key = `${mapping.exchange}:${mapping.symbol}:${s.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ exchange: mapping.exchange, symbol: mapping.symbol, timeframe: s.timeframe });
  }

  return result;
}
