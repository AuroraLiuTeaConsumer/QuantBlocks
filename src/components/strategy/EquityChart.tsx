"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  ColorType,
  LineSeries,
} from "lightweight-charts";

export type EquityPoint = {
  time: string;
  equity: number;
};

export type ChartTrade = {
  side: string;
  entryTime: string;
  entryPrice: number;
};

function toUTCTimestamp(iso: string): Time {
  const d = new Date(iso);
  return (Math.floor(d.getTime() / 1000) as unknown) as Time;
}

export function EquityChart({
  equityCurve,
  trades,
}: {
  equityCurve: EquityPoint[];
  trades: ChartTrade[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
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
        vertLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
        horzLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
      },
      rightPriceScale: {
        borderColor: "#1f2937",
      },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 300,
    });

    chartRef.current = chart;

    const series = chart.addSeries(LineSeries, {
      color: "#10b981",
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    seriesRef.current = series;

    // Build equity data sorted by time
    const sorted = [...equityCurve].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    const lineData = sorted.map((p) => ({
      time: toUTCTimestamp(p.time),
      value: p.equity,
    }));

    if (lineData.length > 0) {
      series.setData(lineData);
    }

    // Build trade markers using v5 createSeriesMarkers API
    const markers: SeriesMarker<Time>[] = trades
      .filter((t) => t.entryTime)
      .map((t) => {
        const isLong =
          t.side.toLowerCase() === "long" || t.side.toLowerCase() === "buy";
        return {
          time: toUTCTimestamp(t.entryTime),
          position: isLong ? ("belowBar" as const) : ("aboveBar" as const),
          color: isLong ? "#22c55e" : "#ef4444",
          shape: isLong ? ("arrowUp" as const) : ("arrowDown" as const),
          text: isLong ? "Buy" : "Sell",
        };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));

    const markersPlugin = createSeriesMarkers(series, markers);
    markersRef.current = markersPlugin;

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        chart.applyOptions({ width });
      }
    });

    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (markersRef.current) {
        markersRef.current.detach();
        markersRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [equityCurve, trades]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height: 300 }}
    />
  );
}
