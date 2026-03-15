import { describe, it, expect } from "vitest";
import { compileGraph, createInitialState, step, forceClose } from "../lib/strategy/engine";
import type { Bar, EngineState } from "../lib/strategy/engine";
import type { StrategyGraph } from "../lib/strategy/graphTypes";

// ── Helpers ──────────────────────────────────────────────────

function makeBar(timeSec: number, close: number, overrides?: Partial<Bar>): Bar {
  return {
    timeSec,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    ...overrides,
  };
}

// A simple graph: price > 105 → open long, price < 95 → close
function simpleLongGraph(): StrategyGraph {
  return {
    nodes: [
      { id: "price1", type: "price", data: { field: "close" }, position: { x: 0, y: 0 } },
      { id: "cmp_open", type: "compare", data: { op: ">", rightType: "number", rightValue: 105 }, position: { x: 100, y: 0 } },
      { id: "open1", type: "open_position", data: { side: "long", qtyType: "fixed", qty: 1 }, position: { x: 200, y: 0 } },
      { id: "cmp_close", type: "compare", data: { op: "<", rightType: "number", rightValue: 95 }, position: { x: 100, y: 100 } },
      { id: "close1", type: "close_position", data: {}, position: { x: 200, y: 100 } },
    ],
    edges: [
      { id: "e1", source: "price1", target: "cmp_open", targetHandle: "left" },
      { id: "e2", source: "cmp_open", target: "open1" },
      { id: "e3", source: "price1", target: "cmp_close", targetHandle: "left" },
      { id: "e4", source: "cmp_close", target: "close1" },
    ],
  };
}

// ── Compilation Tests ────────────────────────────────────────

describe("compileGraph", () => {
  it("compiles a valid graph", () => {
    const result = compileGraph(simpleLongGraph());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.length).toBe(5);
    expect(result.value.actionNodeIds).toContain("open1");
    expect(result.value.actionNodeIds).toContain("close1");
  });

  it("rejects graph with cycle", () => {
    const graph: StrategyGraph = {
      nodes: [
        { id: "a", type: "and", data: {}, position: { x: 0, y: 0 } },
        { id: "b", type: "and", data: {}, position: { x: 100, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    };
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("cycle");
    }
  });

  it("rejects node with missing required input", () => {
    const graph: StrategyGraph = {
      nodes: [
        { id: "open1", type: "open_position", data: { side: "long", qtyType: "fixed", qty: 1 }, position: { x: 0, y: 0 } },
      ],
      edges: [],
    };
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].nodeId).toBe("open1");
      expect(result.errors[0].message).toContain("trigger");
    }
  });

  it("rejects missing edge endpoint", () => {
    const graph: StrategyGraph = {
      nodes: [
        { id: "a", type: "price", data: { field: "close" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "a", target: "nonexistent" },
      ],
    };
    const result = compileGraph(graph);
    expect(result.ok).toBe(false);
  });
});

// ── Runtime Tests ────────────────────────────────────────────

describe("step", () => {
  it("opens a position when condition met", () => {
    const result = compileGraph(simpleLongGraph());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exec = result.value;

    let state = createInitialState(10_000);

    // Bar 1: close=100, no trigger
    const r1 = step(exec, makeBar(1, 100), state);
    state = r1.state;
    expect(r1.events.length).toBe(0);
    expect(state.position).toBeNull();

    // Bar 2: close=106, triggers open
    const r2 = step(exec, makeBar(2, 106), state);
    state = r2.state;
    expect(r2.events.length).toBe(1);
    expect(r2.events[0].kind).toBe("OPENED");
    expect(state.position).not.toBeNull();
    expect(state.position!.side).toBe("long");
    expect(state.position!.entryPrice).toBe(106);
  });

  it("closes a position when condition met", () => {
    const result = compileGraph(simpleLongGraph());
    if (!result.ok) return;
    const exec = result.value;

    let state = createInitialState(10_000);

    // Open
    state = step(exec, makeBar(1, 100), state).state;
    state = step(exec, makeBar(2, 106), state).state;
    expect(state.position).not.toBeNull();

    // Close: price drops to 94
    const r3 = step(exec, makeBar(3, 94), state);
    state = r3.state;

    const closeEvt = r3.events.find((e) => e.kind === "CLOSED");
    expect(closeEvt).toBeDefined();
    expect(closeEvt!.kind).toBe("CLOSED");
    if (closeEvt!.kind === "CLOSED") {
      expect(closeEvt!.pnl).toBe(-12); // 94 - 106 = -12
      expect(closeEvt!.reason).toBe("signal");
    }
    expect(state.position).toBeNull();
    expect(state.realizedPnl).toBe(-12);
  });

  it("does not re-trigger open while condition remains true", () => {
    const result = compileGraph(simpleLongGraph());
    if (!result.ok) return;
    const exec = result.value;

    let state = createInitialState(10_000);
    state = step(exec, makeBar(1, 100), state).state;
    state = step(exec, makeBar(2, 106), state).state; // opens
    expect(state.position).not.toBeNull();

    // Bar 3: still > 105, should NOT re-open (edge trigger: already true)
    const r3 = step(exec, makeBar(3, 110), state);
    state = r3.state;
    const opens = r3.events.filter((e) => e.kind === "OPENED");
    expect(opens.length).toBe(0);
  });
});

// ── Determinism Test ─────────────────────────────────────────

describe("determinism", () => {
  it("produces identical results for identical inputs", () => {
    const graph = simpleLongGraph();
    const bars = [makeBar(1, 100), makeBar(2, 106), makeBar(3, 110), makeBar(4, 94), makeBar(5, 108)];

    function runAll() {
      const result = compileGraph(graph);
      if (!result.ok) throw new Error("compile failed");
      let state = createInitialState(10_000);
      const allEvents: unknown[] = [];
      for (const bar of bars) {
        const r = step(result.value, bar, state);
        state = r.state;
        allEvents.push(...r.events);
      }
      return { finalState: state, allEvents };
    }

    const run1 = runAll();
    const run2 = runAll();

    expect(run1.finalState.equity).toBe(run2.finalState.equity);
    expect(run1.finalState.realizedPnl).toBe(run2.finalState.realizedPnl);
    expect(run1.allEvents).toEqual(run2.allEvents);
  });
});

// ── RSI Indicator Test ───────────────────────────────────────

describe("RSI indicator", () => {
  it("produces values after warmup period", () => {
    const graph: StrategyGraph = {
      nodes: [
        { id: "rsi1", type: "rsi", data: { period: 3 }, position: { x: 0, y: 0 } },
        { id: "const70", type: "constant", data: { value: 70 }, position: { x: 0, y: 100 } },
        { id: "cmp", type: "compare", data: { op: ">", rightType: "series" }, position: { x: 100, y: 0 } },
        { id: "open1", type: "open_position", data: { side: "long", qtyType: "fixed", qty: 1 }, position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "rsi1", target: "cmp", targetHandle: "left" },
        { id: "e2", source: "const70", target: "cmp", targetHandle: "right" },
        { id: "e3", source: "cmp", target: "open1" },
      ],
    };

    const result = compileGraph(graph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let state = createInitialState(10_000);
    // Steadily rising prices → RSI should be high after warmup
    const bars = [100, 102, 104, 106, 108].map((c, i) => makeBar(i, c));

    for (const bar of bars) {
      const r = step(result.value, bar, state, { trace: true });
      state = r.state;
    }

    // After 5 bars with period=3, RSI should be initialized and high (all gains)
    const rsiVal = state.nodeValues["rsi1"];
    expect(rsiVal).not.toBeNull();
    expect(typeof rsiVal).toBe("number");
    expect(rsiVal as number).toBeGreaterThan(70);
  });
});

// ── SL/TP Risk Test ──────────────────────────────────────────

describe("stop loss / take profit", () => {
  it("auto-closes on stop loss", () => {
    // Graph: price > 105 → set_risk(sl=5%) + open long
    const graph: StrategyGraph = {
      nodes: [
        { id: "price1", type: "price", data: { field: "close" }, position: { x: 0, y: 0 } },
        { id: "cmp", type: "compare", data: { op: ">", rightType: "number", rightValue: 105 }, position: { x: 100, y: 0 } },
        { id: "risk1", type: "set_risk", data: { slPct: 5 }, position: { x: 200, y: 0 } },
        { id: "open1", type: "open_position", data: { side: "long", qtyType: "fixed", qty: 1 }, position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "price1", target: "cmp", targetHandle: "left" },
        { id: "e2", source: "cmp", target: "risk1" },
        { id: "e3", source: "cmp", target: "open1" },
      ],
    };

    const result = compileGraph(graph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let state = createInitialState(10_000);
    // Bar 1: no trigger
    state = step(result.value, makeBar(1, 100), state).state;
    // Bar 2: trigger open at 106, SL at 106 * 0.95 = 100.7
    state = step(result.value, makeBar(2, 106), state).state;
    expect(state.position).not.toBeNull();
    expect(state.position!.slPrice).toBeCloseTo(100.7, 1);

    // Bar 3: low dips to 99 (below SL), should auto-close
    const r3 = step(result.value, makeBar(3, 102, { low: 99 }), state);
    state = r3.state;
    const slClose = r3.events.find((e) => e.kind === "CLOSED" && e.reason === "stopLoss");
    expect(slClose).toBeDefined();
    expect(state.position).toBeNull();
  });
});

// ── Force Close Test ─────────────────────────────────────────

describe("forceClose", () => {
  it("closes open position at bar close", () => {
    const result = compileGraph(simpleLongGraph());
    if (!result.ok) return;

    let state = createInitialState(10_000);
    state = step(result.value, makeBar(1, 100), state).state;
    state = step(result.value, makeBar(2, 106), state).state;
    expect(state.position).not.toBeNull();

    const { state: closed, event } = forceClose(state, makeBar(3, 110));
    expect(event).not.toBeNull();
    expect(event!.kind).toBe("CLOSED");
    if (event!.kind === "CLOSED") {
      expect(event!.reason).toBe("endOfRun");
      expect(event!.pnl).toBe(4); // 110 - 106
    }
    expect(closed.position).toBeNull();
    expect(closed.realizedPnl).toBe(4);
  });
});
