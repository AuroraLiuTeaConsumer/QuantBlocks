"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

export type BarItem = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type EquityPoint = {
  time: number;
  value: number;
};

export type ChartTrade = {
  side: "long" | "short";
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
};

function isoToUTCTimestamp(iso: string): number | null {
  const d = new Date(iso);
  const ts = d.getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.floor(ts / 1000);
}

type StrategyChartProps = {
  bars?: BarItem[];
  equity: EquityPoint[];
  trades: ChartTrade[];
  height?: number;
};

const CHART_HEIGHT = 320;

export function StrategyChart({
  bars,
  equity,
  trades,
  height = CHART_HEIGHT,
}: StrategyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const equitySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f1117" },
        textColor: "#9ca3af",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
        horzLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
      },
      rightPriceScale: {
        borderColor: "#1f2937",
      },
      leftPriceScale: {
        borderColor: "#1f2937",
        visible: true,
      },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    let candlestickSeries: ISeriesApi<"Candlestick"> | null = null;

    if (bars != null && bars.length > 0) {
      candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: true,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
      candlestickRef.current = candlestickSeries;

      const sortedBars = [...bars].sort((a, b) => a.time - b.time);
      candlestickSeries.setData(
        sortedBars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );

      // Entry/Exit markers on candlestick series
      const markers: SeriesMarker<Time>[] = [];
      for (const t of trades) {
        const entryTs = isoToUTCTimestamp(t.entryTime);
        if (entryTs != null) {
          const isLong =
            t.side === "long" ||
            t.side.toLowerCase() === "long" ||
            t.side.toLowerCase() === "buy";
          markers.push({
            time: entryTs as Time,
            position: ("belowBar" as const),
            color: isLong ? "#22c55e" : "#ef4444",
            shape: ("arrowUp" as const),
            text: "Entry",
          });
        }
        if (t.exitTime != null && t.exitTime !== "") {
          const exitTs = isoToUTCTimestamp(t.exitTime);
          if (exitTs != null) {
            markers.push({
              time: exitTs as Time,
              position: ("aboveBar" as const),
              color: "#94a3b8",
              shape: ("arrowDown" as const),
              text: "Exit",
            });
          }
        }
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      const markersPlugin = createSeriesMarkers(candlestickSeries, markers);
      markersRef.current = markersPlugin;
    }

    // Equity line (separate scale on the left when candles exist, else main scale)
    const equitySeries = chart.addSeries(LineSeries, {
      color: "#10b981",
      lineWidth: 2,
      priceScaleId: candlestickSeries ? "left" : "right",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });
    equitySeriesRef.current = equitySeries;

    const sortedEquity = [...equity].sort((a, b) => a.time - b.time);
    const lineData = sortedEquity.map((p) => ({
      time: p.time as Time,
      value: p.value,
    }));
    if (lineData.length > 0) {
      equitySeries.setData(lineData);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        chart.applyOptions({ width, height: h });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (markersRef.current) {
        markersRef.current.detach();
        markersRef.current = null;
      }
      if (candlestickSeries) chart.removeSeries(candlestickSeries);
      chart.removeSeries(equitySeries);
      chart.remove();
      chartRef.current = null;
      candlestickRef.current = null;
      equitySeriesRef.current = null;
    };
  }, [bars, equity, trades, height]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
    />
  );
}
