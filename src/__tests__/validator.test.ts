import { describe, it, expect } from "vitest";
import { validateGraph } from "../lib/strategy/validator";
import { EXAMPLE_STRATEGY_NODES, EXAMPLE_STRATEGY_EDGES } from "../lib/data/candles";

describe("validateGraph", () => {
  it("accepts a valid RSI strategy graph", () => {
    const result = validateGraph({
      nodes: EXAMPLE_STRATEGY_NODES,
      edges: EXAMPLE_STRATEGY_EDGES,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects an empty graph", () => {
    const result = validateGraph({ nodes: [], edges: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a graph missing open_position", () => {
    const result = validateGraph({
      nodes: [
        { id: "c1", type: "close_position", position: { x: 0, y: 0 }, data: {} },
        { id: "p1", type: "price", position: { x: 0, y: 0 }, data: { field: "close" } },
      ],
      edges: [{ id: "e1", source: "p1", target: "c1" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_OPEN_POSITION")).toBe(true);
  });

  it("rejects a graph missing both close_position and set_risk", () => {
    const result = validateGraph({
      nodes: [
        {
          id: "op1",
          type: "open_position",
          position: { x: 0, y: 0 },
          data: { side: "long", qty: 0.01 },
        },
        { id: "p1", type: "price", position: { x: 0, y: 0 }, data: { field: "close" } },
      ],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_EXIT")).toBe(true);
  });

  it("detects a cycle", () => {
    const result = validateGraph({
      nodes: [
        {
          id: "op1",
          type: "open_position",
          position: { x: 0, y: 0 },
          data: { side: "long", qty: 0.01 },
        },
        { id: "cp1", type: "close_position", position: { x: 0, y: 0 }, data: {} },
        {
          id: "cmp1",
          type: "compare",
          position: { x: 0, y: 0 },
          data: { op: ">", rightType: "number", rightValue: 50 },
        },
        {
          id: "cmp2",
          type: "compare",
          position: { x: 0, y: 0 },
          data: { op: "<", rightType: "number", rightValue: 30 },
        },
      ],
      edges: [
        // Cycle: cmp1 -> cmp2 -> cmp1
        { id: "e1", source: "cmp1", target: "cmp2" },
        { id: "e2", source: "cmp2", target: "cmp1" },
        { id: "e3", source: "cmp1", target: "op1" },
        { id: "e4", source: "cmp2", target: "cp1" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("rejects edges pointing to source-only nodes", () => {
    const result = validateGraph({
      nodes: [
        { id: "p1", type: "price", position: { x: 0, y: 0 }, data: { field: "close" } },
        { id: "p2", type: "price", position: { x: 0, y: 0 }, data: { field: "open" } },
        {
          id: "cmp1",
          type: "compare",
          position: { x: 0, y: 0 },
          data: { op: ">", rightType: "number", rightValue: 50000 },
        },
        {
          id: "op1",
          type: "open_position",
          position: { x: 0, y: 0 },
          data: { side: "long", qty: 0.01 },
        },
        { id: "cp1", type: "close_position", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        // Invalid: p2 (price) has an incoming edge from p1
        { id: "e1", source: "p1", target: "p2" },
        { id: "e2", source: "p1", target: "cmp1" },
        { id: "e3", source: "cmp1", target: "op1" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CONNECTION")).toBe(true);
  });

  it("accepts a graph with set_risk instead of close_position", () => {
    const result = validateGraph({
      nodes: [
        { id: "rsi1", type: "rsi", position: { x: 0, y: 0 }, data: { period: 14 } },
        { id: "c30", type: "constant", position: { x: 0, y: 0 }, data: { value: 30 } },
        {
          id: "cmp1",
          type: "compare",
          position: { x: 0, y: 0 },
          data: { op: "<", rightType: "series" },
        },
        {
          id: "op1",
          type: "open_position",
          position: { x: 0, y: 0 },
          data: { side: "long", qty: 0.01 },
        },
        {
          id: "sr1",
          type: "set_risk",
          position: { x: 0, y: 0 },
          data: { slPct: 2, tpPct: 5 },
        },
      ],
      edges: [
        { id: "e1", source: "rsi1", target: "cmp1", targetHandle: "left" },
        { id: "e2", source: "c30", target: "cmp1", targetHandle: "right" },
        { id: "e3", source: "cmp1", target: "op1" },
        { id: "e4", source: "cmp1", target: "sr1" },
      ],
    });
    expect(result.valid).toBe(true);
  });
});
