/**
 * Paper Trading helpers — session snapshot conversion and DB row types.
 *
 * The actual strategy evaluation is now handled by the shared engine
 * at /src/lib/strategy/engine/. This module only provides:
 * - SessionRow / SessionSnapshot types
 * - toSnapshot() for API responses
 */

// ── Types ────────────────────────────────────────────────────

export type SessionSnapshot = {
  id: string;
  strategyId: string;
  status: string;
  instrument: string;
  timeframe: string;
  lastPrice: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  position: {
    side: "long" | "short" | null;
    qty: number;
    entryPrice: number | null;
  };
  startedAt: string | null;
  updatedAt: string;
};

/** Minimal DB row shape (matches Prisma PaperSession). */
export type SessionRow = {
  id: string;
  strategyId: string;
  status: string;
  instrument: string;
  timeframe: string;
  lastPrice: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positionSide: string | null;
  positionQty: number;
  positionEntryPrice: number | null;
  startedAt: Date | null;
  updatedAt: Date;
};

// ── Snapshot helper ──────────────────────────────────────────

export function toSnapshot(row: SessionRow): SessionSnapshot {
  return {
    id: row.id,
    strategyId: row.strategyId,
    status: row.status,
    instrument: row.instrument,
    timeframe: row.timeframe,
    lastPrice: row.lastPrice,
    equity: row.equity,
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    position: {
      side: (row.positionSide as "long" | "short") ?? null,
      qty: row.positionQty,
      entryPrice: row.positionEntryPrice,
    },
    startedAt: row.startedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
