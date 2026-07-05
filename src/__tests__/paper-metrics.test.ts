import { describe, expect, it } from "vitest";
import { computeMetrics } from "../lib/backtest/metrics";
import type { Candle, EquityPoint, TradeRecord } from "../lib/backtest/backtest";
import { computePaperMetrics, recordPaperBar } from "../lib/paper/metrics";

describe("paper performance metrics", () => {
  it("matches backtest metric conventions for the same series", () => {
    const times = [
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T01:00:00.000Z",
      "2026-01-01T02:00:00.000Z",
    ];
    const equities = [10_100, 9_900, 10_300];
    const closes = [100, 90, 120];
    const closedPnls = [[], [100], [-200]];

    let performance;
    let previousEquity = 10_000;
    for (let index = 0; index < equities.length; index += 1) {
      performance = recordPaperBar(
        performance,
        10_000,
        previousEquity,
        equities[index],
        closes[index],
        closedPnls[index],
      );
      previousEquity = equities[index];
    }

    const equityCurve: EquityPoint[] = times.map((time, index) => ({
      time,
      equity: equities[index],
    }));
    const candles: Candle[] = times.map((time, index) => ({
      time,
      open: closes[index],
      high: closes[index],
      low: closes[index],
      close: closes[index],
      volume: 1,
    }));
    const trades: TradeRecord[] = [100, -200].map((pnl, index) => ({
      side: "long",
      entryTime: times[index],
      entryPrice: 100,
      exitTime: times[index + 1],
      exitPrice: 100,
      qty: 1,
      pnl,
      reasonOpen: "test",
      reasonClose: "test",
    }));

    const backtest = computeMetrics(
      trades,
      10_000,
      equityCurve,
      candles,
      0,
      3_600_000,
    );
    const paper = computePaperMetrics(performance, 10_000, 10_300, "1h");

    expect(paper).toEqual(backtest);
  });
});
