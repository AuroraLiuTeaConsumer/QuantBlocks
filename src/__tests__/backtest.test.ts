import { describe, it, expect } from "vitest";
import { runBacktest, DEFAULT_CONFIG } from "../lib/backtest/backtest";
import type { StrategyGraph } from "../lib/strategy/graphTypes";
import { SAMPLE_CANDLES, EXAMPLE_STRATEGY_NODES, EXAMPLE_STRATEGY_EDGES } from "../lib/data/candles";

const exampleGraph: StrategyGraph = {
  nodes: EXAMPLE_STRATEGY_NODES as StrategyGraph["nodes"],
  edges: EXAMPLE_STRATEGY_EDGES as StrategyGraph["edges"],
};

describe("backtest engine", () => {
  it("produces at least one trade on sample candles with the RSI strategy", () => {
    const result = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    // The first trade should be long (RSI < 30 → open long)
    expect(result.trades[0].side).toBe("long");
  });

  it("is deterministic — running twice yields identical metrics", () => {
    const r1 = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    const r2 = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);

    expect(r1.metrics).toEqual(r2.metrics);
    expect(r1.trades.length).toBe(r2.trades.length);
    for (let i = 0; i < r1.trades.length; i++) {
      expect(r1.trades[i].entryPrice).toBe(r2.trades[i].entryPrice);
      expect(r1.trades[i].exitPrice).toBe(r2.trades[i].exitPrice);
      expect(r1.trades[i].pnl).toBe(r2.trades[i].pnl);
    }
    expect(r1.equityCurve.length).toBe(r2.equityCurve.length);
  });

  it("equity curve has the same length as candles", () => {
    const result = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    expect(result.equityCurve.length).toBe(SAMPLE_CANDLES.length);
  });

  it("closed trades have non-null exit fields", () => {
    const result = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    for (const t of result.trades) {
      expect(t.exitPrice).not.toBeNull();
      expect(t.exitTime).not.toBeNull();
      expect(t.reasonClose).not.toBeNull();
    }
  });

  it("fills at signal bar close (same model as paper engine)", () => {
    const result = runBacktest(exampleGraph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    if (result.trades.length === 0) return;

    const firstTrade = result.trades[0];
    const closePrices = SAMPLE_CANDLES.map((c) => c.close);
    expect(closePrices).toContain(firstTrade.entryPrice);
  });

  it("handles SL/TP with worst-case when both hit", () => {
    // Build a graph with open_position + set_risk (tight SL/TP)
    const graph: StrategyGraph = {
      nodes: [
        { id: "rsi-1", type: "rsi", position: { x: 0, y: 0 }, data: { period: 14 } },
        { id: "c30", type: "constant", position: { x: 0, y: 0 }, data: { value: 30 } },
        {
          id: "cmp-buy",
          type: "compare",
          position: { x: 0, y: 0 },
          data: { op: "<", rightType: "series" },
        },
        {
          id: "open-long",
          type: "open_position",
          position: { x: 0, y: 0 },
          data: { side: "long", qtyType: "fixed", qty: 0.01 },
        },
        {
          id: "risk",
          type: "set_risk",
          position: { x: 0, y: 0 },
          data: { slPct: 0.1, tpPct: 0.1 }, // very tight — both may hit in one bar
        },
      ],
      edges: [
        { id: "e1", source: "rsi-1", target: "cmp-buy", targetHandle: "left" },
        { id: "e2", source: "c30", target: "cmp-buy", targetHandle: "right" },
        { id: "e3", source: "cmp-buy", target: "open-long" },
        { id: "e4", source: "cmp-buy", target: "risk" },
      ],
    };

    const result = runBacktest(graph, SAMPLE_CANDLES, DEFAULT_CONFIG);
    // Should still complete without error
    expect(result.metrics).toBeDefined();
    // If a trade was closed due to SL, the reasonClose should mention SL
    for (const t of result.trades) {
      if (t.reasonClose && t.reasonClose.includes("SL")) {
        // Worst-case: SL hit first when both triggered
        expect(t.pnl).toBeLessThanOrEqual(0);
      }
    }
  });

  it("respects initial capital and fee deduction", () => {
    const config = { ...DEFAULT_CONFIG, initialCapital: 50_000, feeBps: 10 };
    const result = runBacktest(exampleGraph, SAMPLE_CANDLES, config);
    // Starting equity should be close to initial capital
    expect(result.equityCurve[0].equity).toBeLessThanOrEqual(config.initialCapital);
    // Net PnL should account for fees (slightly lower than without fees)
    const noFeeResult = runBacktest(exampleGraph, SAMPLE_CANDLES, { ...config, feeBps: 0 });
    expect(result.metrics.netPnl).toBeLessThanOrEqual(noFeeResult.metrics.netPnl);
  });
});
