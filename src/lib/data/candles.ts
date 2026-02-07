import type { Candle } from "../strategy/compiler";

/**
 * 60 synthetic 1h BTC-PERP candles for testing.
 *
 * The price pattern is designed so that a standard RSI(14) strategy
 * (buy when RSI < 30, sell when RSI > 70) produces at least one
 * complete long trade:
 *
 *   Bars  0-14 : Gentle uptrend ~50000 → ~50300  (RSI ≈ neutral)
 *   Bars 15-25 : Sharp decline  ~50300 → ~46800  (RSI drops below 30)
 *   Bars 26-45 : Strong recovery ~46800 → ~54800 (RSI rises above 70)
 *   Bars 46-59 : Sideways/gentle decline          (RSI ≈ neutral)
 */

const closePrices: number[] = [
  50000, 50100, 50050, 50150, 50100, 50200, 50150, 50250, 50200, 50300,
  50250, 50200, 50150, 50100, 50050,
  49800, 49500, 49200, 48900, 48600, 48300, 48000, 47700, 47400, 47100, 46800,
  47200, 47600, 48000, 48400, 48800, 49200, 49600, 50000, 50400, 50800,
  51200, 51600, 52000, 52400, 52800, 53200, 53600, 54000, 54400, 54800,
  54700, 54600, 54700, 54600, 54700, 54600, 54700, 54600, 54700, 54600,
  54500, 54400, 54300, 54200,
];

const BASE_TIME = new Date("2025-01-01T00:00:00Z").getTime();

export const SAMPLE_CANDLES: Candle[] = closePrices.map((close, i) => {
  const prevClose = i > 0 ? closePrices[i - 1] : close;
  const open = prevClose;
  const high = Math.max(open, close) + 50;
  const low = Math.min(open, close) - 50;
  return {
    time: new Date(BASE_TIME + i * 3600_000).toISOString(),
    open,
    high,
    low,
    close,
    volume: 100,
  };
});

/**
 * The example RSI strategy graph used by the seed and AI stub.
 *
 * Nodes:
 *   rsi-1         RSI(14)
 *   const-30      Constant 30  (oversold threshold)
 *   const-70      Constant 70  (overbought threshold)
 *   cmp-buy       compare: RSI < 30
 *   cmp-sell      compare: RSI > 70
 *   open-long     open_position long 0.01
 *   close-pos     close_position
 */
export const EXAMPLE_STRATEGY_NODES = [
  { id: "rsi-1", type: "rsi", position: { x: 50, y: 100 }, data: { period: 14 } },
  { id: "const-30", type: "constant", position: { x: 50, y: 250 }, data: { value: 30 } },
  { id: "const-70", type: "constant", position: { x: 50, y: 400 }, data: { value: 70 } },
  {
    id: "cmp-buy",
    type: "compare",
    position: { x: 300, y: 150 },
    data: { op: "<", rightType: "series" },
  },
  {
    id: "cmp-sell",
    type: "compare",
    position: { x: 300, y: 350 },
    data: { op: ">", rightType: "series" },
  },
  {
    id: "open-long",
    type: "open_position",
    position: { x: 550, y: 150 },
    data: { side: "long", qtyType: "fixed", qty: 0.01 },
  },
  {
    id: "close-pos",
    type: "close_position",
    position: { x: 550, y: 350 },
    data: {},
  },
];

export const EXAMPLE_STRATEGY_EDGES = [
  { id: "e1", source: "rsi-1", target: "cmp-buy", targetHandle: "left" },
  { id: "e2", source: "const-30", target: "cmp-buy", targetHandle: "right" },
  { id: "e3", source: "rsi-1", target: "cmp-sell", targetHandle: "left" },
  { id: "e4", source: "const-70", target: "cmp-sell", targetHandle: "right" },
  { id: "e5", source: "cmp-buy", target: "open-long" },
  { id: "e6", source: "cmp-sell", target: "close-pos" },
];
