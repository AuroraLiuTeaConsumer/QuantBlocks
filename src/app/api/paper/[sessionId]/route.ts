import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toSnapshot } from "@/lib/paper/engine";
import type { SessionRow } from "@/lib/paper/engine";
import { advanceSession } from "@/lib/paper/advance";
import { getTimescaleRepo } from "@/lib/market-data/storage/timescale.repo";
import { resolveInstrument, isTimeframe } from "@/lib/market-data/types";
import type { Timeframe } from "@/lib/market-data/types";

const MAX_RETRIES = 3;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const session = await prisma.paperSession.findUnique({
    where: { id: sessionId },
    include: { strategy: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "running") {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  const mapping = resolveInstrument(session.instrument);
  if (!mapping) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  if (!isTimeframe(session.timeframe)) {
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }
  const timeframe = session.timeframe as Timeframe;

  // ── Fetch the next batch of real candles ──────────────────────────────────

  type RealBar = { openTime: Date; open: number; high: number; low: number; close: number };

  let realBars: RealBar[] = [];
  let dbError = false;

  try {
    const repo = getTimescaleRepo();
    const sessionStart = session.startedAt ?? new Date();
    const defaultStart = new Date(sessionStart.getTime() - 90 * 24 * 3600 * 1_000);
    const cursor = session.barCursor ?? defaultStart;
    const candles = await repo.queryCandles({
      exchange: mapping.exchange,
      symbol: mapping.symbol,
      timeframe,
      startTime: cursor,
      endTime: new Date(),
      limit: 5,
    });
    realBars = candles.map((c) => ({
      openTime: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  } catch {
    dbError = true;
  }

  if (realBars.length === 0) {
    if (dbError) {
      // DB temporarily unavailable — keep session running, retry next poll
      return NextResponse.json(toSnapshot(session as unknown as SessionRow));
    }
    // poll-mode sessions auto-stop when they catch up to the latest candle.
    // worker-mode sessions idle indefinitely — the background paper-worker drives
    // them; if the worker process dies, client polls still advance the session
    // but must NOT auto-stop it (idempotency guarantee in advanceSession handles
    // the concurrent-writer scenario safely).
    if (session.mode === "poll") {
      await prisma.paperSession.updateMany({
        where: { id: sessionId, status: "running" },
        data: { status: "stopped" },
      });
      const stopped = await prisma.paperSession.findUnique({ where: { id: sessionId } });
      if (!stopped) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      return NextResponse.json(toSnapshot(stopped as unknown as SessionRow));
    }
    // Non-poll (worker) mode — caught up to live edge; return running snapshot unchanged.
    return NextResponse.json(toSnapshot(session as unknown as SessionRow));
  }

  // ── Advance the session ───────────────────────────────────────────────────

  const result = await advanceSession(sessionId, realBars, MAX_RETRIES);

  if (result.kind === "noop" || (result.kind === "skipped" && result.reason !== "compile-error")) {
    const fresh = await prisma.paperSession.findUnique({ where: { id: sessionId } });
    if (!fresh) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(toSnapshot(fresh as unknown as SessionRow));
  }

  if (result.kind === "skipped" && result.reason === "compile-error") {
    return NextResponse.json(
      { error: "Strategy compilation failed", details: result.errors },
      { status: 500 },
    );
  }

  // kind === 'advanced' — re-read session to return fresh state
  const updated = await prisma.paperSession.findUnique({ where: { id: sessionId } });
  if (!updated) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const snap = toSnapshot(updated as unknown as SessionRow);
  return NextResponse.json(result.lastBar ? { ...snap, lastBar: result.lastBar } : snap);
}
