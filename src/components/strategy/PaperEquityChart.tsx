"use client";

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type Ref,
} from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

// ── Public types ─────────────────────────────────────────────

export type EquityPoint = { time: number; value: number };

export type ChartMarker = {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  text?: string;
  color?: string;
};

export type PaperEquityChartHandle = {
  appendEquity: (point: EquityPoint) => void;
  setMarkers: (markers: ChartMarker[]) => void;
  reset: () => void;
};

type Props = {
  height?: number;
  initialEquity?: EquityPoint[];
};

const DEFAULT_HEIGHT = 260;

// ── Component ────────────────────────────────────────────────

export const PaperEquityChart = forwardRef(function PaperEquityChart(
  { height = DEFAULT_HEIGHT, initialEquity }: Props,
  ref: Ref<PaperEquityChartHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // Keep sorted markers in a ref so setMarkers can accumulate
  const markersDataRef = useRef<SeriesMarker<Time>[]>([]);

  // Create chart once on mount, destroy on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
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
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: true,
        secondsVisible: true,
      },
      width: container.clientWidth,
      height,
    });
    chartRef.current = chart;

    const series = chart.addSeries(LineSeries, {
      color: "#10b981",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    seriesRef.current = series;

    // Seed with initial data if provided
    if (initialEquity && initialEquity.length > 0) {
      const sorted = [...initialEquity].sort((a, b) => a.time - b.time);
      series.setData(sorted.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    // Create empty markers plugin — we'll update it via setMarkers
    const plugin = createSeriesMarkers(series, []);
    markersPluginRef.current = plugin;

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (markersPluginRef.current) {
        markersPluginRef.current.detach();
        markersPluginRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersDataRef.current = [];
    };
    // height and initialEquity intentionally excluded — chart is long-lived,
    // we stream updates imperatively instead of re-creating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Imperative API ─────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    appendEquity(point: EquityPoint) {
      const series = seriesRef.current;
      if (!series) return;
      // series.update() appends if time > last bar, or updates last bar if time ==
      series.update({ time: point.time as Time, value: point.value });
      // Auto-scroll to latest
      chartRef.current?.timeScale().scrollToRealTime();
    },

    setMarkers(markers: ChartMarker[]) {
      const plugin = markersPluginRef.current;
      if (!plugin) return;
      const converted: SeriesMarker<Time>[] = markers.map((m) => ({
        time: m.time as Time,
        position: m.position,
        shape: m.shape,
        text: m.text ?? "",
        color: m.color ?? "#94a3b8",
      }));
      // lightweight-charts requires markers sorted by time ascending
      converted.sort((a, b) => (a.time as number) - (b.time as number));
      markersDataRef.current = converted;
      plugin.setMarkers(converted);
    },

    reset() {
      const series = seriesRef.current;
      if (series) {
        series.setData([]);
      }
      markersDataRef.current = [];
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
    },
  }));

  return <div ref={containerRef} className="w-full" style={{ height }} />;
});
