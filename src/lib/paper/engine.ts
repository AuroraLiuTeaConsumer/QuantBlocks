/**
 * Paper Trading Simulation Engine
 *
 * Pull-based: each GET poll calls `advanceSession` which steps the simulation
 * forward based on wall-clock elapsed time. No server-side intervals needed.
 *
 * ## Extending later
 * Replace `stubDecide()` with:
 *   evaluateStrategy(graph: StrategyGraph, price: number, candle: Candle) => Signal[]
 * Replace `randomWalkPrice()` with a real price feed (websocket / REST from exchange).
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

/** Minimal DB row shape the engine operates on (matches Prisma PaperSession). */
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

export type NewTrade = {
  sessionId: string;
  side: "long" | "short";
  qty: number;
  entryTime: Date;
  entryPrice: number;
  exitTime: Date | null;
  exitPrice: number | null;
  pnl: number;
};

export type StepResult = {
  updates: Partial<SessionRow>;
  trades: NewTrade[];
};

// ── Constants ────────────────────────────────────────────────

const MAX_STEPS_PER_POLL = 10;
const STEP_INTERVAL_MS = 1000; // 1 simulated second per step
const PRICE_VOLATILITY = 0.002; // 0.2% per step
const OPEN_PROBABILITY = 0.08; // ~8% chance per step to open
const CLOSE_PROBABILITY = 0.12; // ~12% chance per step to close
const DEFAULT_QTY = 1;

// ── Price simulation ─────────────────────────────────────────

function randomWalkPrice(current: number): number {
  const change = current * PRICE_VOLATILITY * (Math.random() * 2 - 1);
  return Math.max(0.01, +(current + change).toFixed(4));
}

// ── PnL helpers ──────────────────────────────────────────────

export function computeUnrealizedPnl(session: SessionRow): number {
  if (!session.positionSide || session.positionQty === 0 || session.positionEntryPrice == null) {
    return 0;
  }
  const diff = session.lastPrice - session.positionEntryPrice;
  const direction = session.positionSide === "long" ? 1 : -1;
  return +(diff * direction * session.positionQty).toFixed(4);
}

// ── Position management ──────────────────────────────────────

export function openPosition(
  session: SessionRow,
  side: "long" | "short",
  qty: number,
  price: number,
  now: Date,
): { updates: Partial<SessionRow>; trade: NewTrade } {
  const updates: Partial<SessionRow> = {
    positionSide: side,
    positionQty: qty,
    positionEntryPrice: price,
  };
  const trade: NewTrade = {
    sessionId: session.id,
    side,
    qty,
    entryTime: now,
    entryPrice: price,
    exitTime: null,
    exitPrice: null,
    pnl: 0,
  };
  return { updates, trade };
}

export function closePosition(
  session: SessionRow,
  price: number,
  now: Date,
): { updates: Partial<SessionRow>; trade: NewTrade } | null {
  if (!session.positionSide || session.positionQty === 0 || session.positionEntryPrice == null) {
    return null;
  }
  const diff = price - session.positionEntryPrice;
  const direction = session.positionSide === "long" ? 1 : -1;
  const pnl = +(diff * direction * session.positionQty).toFixed(4);

  const trade: NewTrade = {
    sessionId: session.id,
    side: session.positionSide as "long" | "short",
    qty: session.positionQty,
    entryTime: now, // will be overwritten by caller with actual entry time
    entryPrice: session.positionEntryPrice,
    exitTime: now,
    exitPrice: price,
    pnl,
  };

  const updates: Partial<SessionRow> = {
    positionSide: null,
    positionQty: 0,
    positionEntryPrice: null,
    realizedPnl: +(session.realizedPnl + pnl).toFixed(4),
    equity: +(session.equity + pnl).toFixed(4),
    unrealizedPnl: 0,
  };

  return { updates, trade };
}

// ── Stub decision logic ──────────────────────────────────────
// Replace this with evaluateStrategy(graph, price) => Signal[] later.

function stubDecide(session: SessionRow): "open_long" | "open_short" | "close" | null {
  const hasPosition = session.positionSide != null && session.positionQty > 0;

  if (!hasPosition) {
    if (Math.random() < OPEN_PROBABILITY) {
      return Math.random() < 0.5 ? "open_long" : "open_short";
    }
    return null;
  }

  if (Math.random() < CLOSE_PROBABILITY) {
    return "close";
  }
  return null;
}

// ── Core step function ───────────────────────────────────────

/**
 * Advance the session by `steps` ticks. Pure function — caller persists results.
 */
export function advanceSession(session: SessionRow, now: Date): StepResult {
  const elapsed = now.getTime() - session.updatedAt.getTime();
  const steps = Math.min(Math.max(Math.floor(elapsed / STEP_INTERVAL_MS), 0), MAX_STEPS_PER_POLL);

  if (steps === 0) {
    return { updates: { unrealizedPnl: computeUnrealizedPnl(session) }, trades: [] };
  }

  // Mutable working copy
  const s: SessionRow = { ...session };
  const trades: NewTrade[] = [];

  for (let i = 0; i < steps; i++) {
    // 1) Advance price
    s.lastPrice = randomWalkPrice(s.lastPrice);

    // 2) Decide action
    const decision = stubDecide(s);

    if (decision === "close") {
      const result = closePosition(s, s.lastPrice, now);
      if (result) {
        Object.assign(s, result.updates);
        trades.push(result.trade);
      }
    } else if (decision === "open_long" || decision === "open_short") {
      const side = decision === "open_long" ? "long" : "short";
      const { updates, trade } = openPosition(s, side, DEFAULT_QTY, s.lastPrice, now);
      Object.assign(s, updates);
      trades.push(trade);
    }

    // 3) Update unrealized PnL
    s.unrealizedPnl = computeUnrealizedPnl(s);
  }

  const updates: Partial<SessionRow> = {
    lastPrice: s.lastPrice,
    equity: s.equity,
    realizedPnl: s.realizedPnl,
    unrealizedPnl: s.unrealizedPnl,
    positionSide: s.positionSide,
    positionQty: s.positionQty,
    positionEntryPrice: s.positionEntryPrice,
  };

  return { updates, trades };
}

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
