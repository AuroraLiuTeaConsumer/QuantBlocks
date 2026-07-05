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
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type IRange,
} from "lightweight-charts";

// ── Public types ─────────────────────────────────────────────

export type BarItem = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type EquityPoint = { time: number; value: number };
export type PricePoint = { time: number; value: number };

export type ChartTrade = {
  id?: string;
  side: "long" | "short";
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  qty?: number;
  pnl?: number;
};

export type ChartMarker = {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown";
  text?: string;
  color?: string;
};

export type TwoPaneChartHandle = {
  appendEquity: (point: EquityPoint) => void;
  appendPrice: (point: PricePoint) => void;
  appendBar: (bar: BarItem) => void;
  initBars: (bars: BarItem[]) => void;
  replaceBars: (bars: BarItem[]) => void;
  setMarkers: (markers: ChartMarker[]) => void;
  reset: () => void;
};

type TwoPaneChartProps = {
  heightTop?: number;
  heightBottom?: number;
  bars?: BarItem[];
  equity?: EquityPoint[];
  trades?: ChartTrade[];
  mode: "backtest" | "paper";
  streaming?: boolean;
};

// ── Shared chart options ─────────────────────────────────────

const CHART_LAYOUT = {
  background: { type: ColorType.Solid as const, color: "#0f1117" },
  textColor: "#9ca3af",
  fontSize: 12,
};

const CHART_GRID = {
  vertLines: { color: "#1f2937" },
  horzLines: { color: "#1f2937" },
};

const CHART_CROSSHAIR = {
  vertLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
  horzLine: { color: "#4b5563", labelBackgroundColor: "#374151" },
};

function isoToSec(iso: string): number | null {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.floor(ts / 1000);
}

function buildMarkers(trades: ChartTrade[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const entryTs = isoToSec(t.entryTime);
    if (entryTs != null) {
      const isLong = t.side === "long";
      markers.push({
        time: entryTs as Time,
        position: "belowBar" as const,
        color: isLong ? "#22c55e" : "#ef4444",
        shape: "arrowUp" as const,
        text: "Entry",
      });
    }
    if (t.exitTime) {
      const exitTs = isoToSec(t.exitTime);
      if (exitTs != null) {
        markers.push({
          time: exitTs as Time,
          position: "aboveBar" as const,
          color: "#94a3b8",
          shape: "arrowDown" as const,
          text: "Exit",
        });
      }
    }
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

// ── Component ────────────────────────────────────────────────

const DEFAULT_TOP = 320;
const DEFAULT_BOTTOM = 180;

export const TwoPaneChart = forwardRef(function TwoPaneChart(
  {
    heightTop = DEFAULT_TOP,
    heightBottom = DEFAULT_BOTTOM,
    bars,
    equity,
    trades,
    mode,
    streaming = false,
  }: TwoPaneChartProps,
  ref: Ref<TwoPaneChartHandle>,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const topContainerRef = useRef<HTMLDivElement>(null);
  const bottomContainerRef = useRef<HTMLDivElement>(null);

  // Chart instances
  const topChartRef = useRef<IChartApi | null>(null);
  const bottomChartRef = useRef<IChartApi | null>(null);

  // Series refs
  const candlestickRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const equitySeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Sync guard to prevent infinite loop
  const isSyncingRef = useRef(false);

  // ── Create charts ────────────────────────────────────────

  useEffect(() => {
    const topEl = topContainerRef.current;
    const bottomEl = bottomContainerRef.current;
    if (!topEl || !bottomEl) return;

    const width = topEl.clientWidth;

    // ─ Top chart (price) ─────────────────────────────────
    const topChart = createChart(topEl, {
      layout: CHART_LAYOUT,
      grid: CHART_GRID,
      crosshair: { mode: 1, ...CHART_CROSSHAIR },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: true,
        secondsVisible: mode === "paper",
      },
      width,
      height: heightTop,
    });
    topChartRef.current = topChart;

    // Top pane: candlestick for backtest (static bars) and paper (streaming).
    // Line series is kept only for non-streaming charts with no OHLC data.
    const useCandlestick = (bars != null && bars.length > 0) || streaming;

    if (useCandlestick) {
      const cs = topChart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: true,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
      candlestickRef.current = cs;

      if (bars && bars.length > 0) {
        const sorted = [...bars].sort((a, b) => a.time - b.time);
        cs.setData(
          sorted.map((b) => ({
            time: b.time as Time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          })),
        );
      }

      if (trades && trades.length > 0) {
        markersPluginRef.current = createSeriesMarkers(cs, buildMarkers(trades));
      } else {
        markersPluginRef.current = createSeriesMarkers(cs, []);
      }
    } else {
      // Line series — only for non-streaming charts with no OHLC data
      const ls = topChart.addSeries(LineSeries, {
        color: "#60a5fa",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
      });
      priceLineRef.current = ls;
      markersPluginRef.current = createSeriesMarkers(ls, []);
    }

    // ─ Bottom chart (equity) ─────────────────────────────
    const bottomChart = createChart(bottomEl, {
      layout: CHART_LAYOUT,
      grid: CHART_GRID,
      crosshair: { mode: 1, ...CHART_CROSSHAIR },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: {
        borderColor: "#1f2937",
        timeVisible: true,
        secondsVisible: mode === "paper",
      },
      width,
      height: heightBottom,
    });
    bottomChartRef.current = bottomChart;

    const eqSeries = bottomChart.addSeries(LineSeries, {
      color: "#10b981",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    equitySeriesRef.current = eqSeries;

    // Seed equity data if provided
    if (equity && equity.length > 0) {
      const sorted = [...equity].sort((a, b) => a.time - b.time);
      eqSeries.setData(sorted.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    // Fit both
    topChart.timeScale().fitContent();
    bottomChart.timeScale().fitContent();

    // ── TimeScale sync (bi-directional) ──────────────────
    // Synchronize by timestamp, not logical point index. The price pane can
    // contain every candle while the equity pane is sampled once per processed
    // batch, so equal logical indexes do not necessarily represent equal dates.

    const onTopRangeChange = (range: IRange<Time> | null) => {
      if (
        isSyncingRef.current ||
        !range ||
        range.from == null ||
        range.to == null ||
        bottomChart.timeScale().getVisibleRange() == null
      ) {
        return;
      }
      isSyncingRef.current = true;
      try {
        bottomChart.timeScale().setVisibleRange(range);
      } catch {
        // The target scale may be between setData([]) and its next update.
      } finally {
        isSyncingRef.current = false;
      }
    };

    const onBottomRangeChange = (range: IRange<Time> | null) => {
      if (
        isSyncingRef.current ||
        !range ||
        range.from == null ||
        range.to == null ||
        topChart.timeScale().getVisibleRange() == null
      ) {
        return;
      }
      isSyncingRef.current = true;
      try {
        topChart.timeScale().setVisibleRange(range);
      } catch {
        // The target scale may be between setData([]) and its next update.
      } finally {
        isSyncingRef.current = false;
      }
    };

    topChart.timeScale().subscribeVisibleTimeRangeChange(onTopRangeChange);
    bottomChart.timeScale().subscribeVisibleTimeRangeChange(onBottomRangeChange);

    // ── Crosshair sync ───────────────────────────────────
    // lightweight-charts v5 exposes setCrosshairPosition(price, time, series).
    // We sync the vertical crosshair line between panes.

    const topSeries = candlestickRef.current ?? priceLineRef.current;

    topChart.subscribeCrosshairMove((param) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      if (param.time) {
        const eqData = param.seriesData?.get(topSeries!);
        const price = eqData && "value" in eqData ? eqData.value : eqData && "close" in eqData ? eqData.close : 0;
        bottomChart.setCrosshairPosition(price as number, param.time, eqSeries);
      } else {
        bottomChart.clearCrosshairPosition();
      }
      isSyncingRef.current = false;
    });

    bottomChart.subscribeCrosshairMove((param) => {
      if (isSyncingRef.current || !topSeries) return;
      isSyncingRef.current = true;
      if (param.time) {
        const eqData = param.seriesData?.get(eqSeries);
        const price = eqData && "value" in eqData ? eqData.value : 0;
        topChart.setCrosshairPosition(price as number, param.time, topSeries);
      } else {
        topChart.clearCrosshairPosition();
      }
      isSyncingRef.current = false;
    });

    // ── ResizeObserver ────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        topChart.applyOptions({ width: w });
        bottomChart.applyOptions({ width: w });
      }
    });
    if (wrapperRef.current) ro.observe(wrapperRef.current);

    // ── Cleanup ──────────────────────────────────────────
    return () => {
      ro.disconnect();
      topChart.timeScale().unsubscribeVisibleTimeRangeChange(onTopRangeChange);
      bottomChart.timeScale().unsubscribeVisibleTimeRangeChange(onBottomRangeChange);
      if (markersPluginRef.current) {
        markersPluginRef.current.detach();
        markersPluginRef.current = null;
      }
      topChart.remove();
      bottomChart.remove();
      topChartRef.current = null;
      bottomChartRef.current = null;
      candlestickRef.current = null;
      priceLineRef.current = null;
      equitySeriesRef.current = null;
    };
    // For streaming mode, chart is long-lived (deps=[]).
    // For static mode, re-create when data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, streaming ? [] : [bars, equity, trades, mode, heightTop, heightBottom]);

  // ── Imperative handle (streaming mode) ─────────────────

  useImperativeHandle(ref, () => ({
    appendEquity(point: EquityPoint) {
      const series = equitySeriesRef.current;
      if (!series) return;
      series.update({ time: point.time as Time, value: point.value });
      bottomChartRef.current?.timeScale().scrollToRealTime();
    },

    appendPrice(point: PricePoint) {
      const series = priceLineRef.current;
      if (!series) return;
      series.update({ time: point.time as Time, value: point.value });
      topChartRef.current?.timeScale().scrollToRealTime();
    },

    appendBar(bar: BarItem) {
      const series = candlestickRef.current;
      if (!series) return;
      series.update({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      topChartRef.current?.timeScale().scrollToRealTime();
    },

    initBars(bars: BarItem[]) {
      const series = candlestickRef.current;
      if (!series) return;
      const sorted = [...bars].sort((a, b) => a.time - b.time);
      series.setData(
        sorted.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );

      // Give the equity pane the same historical time domain without inventing
      // equity values before the paper session starts. These whitespace points
      // let timestamp-based zooming and scrolling align both panes exactly.
      equitySeriesRef.current?.setData(
        sorted.map((b) => ({ time: b.time as Time })),
      );
      topChartRef.current?.timeScale().fitContent();
      bottomChartRef.current?.timeScale().fitContent();
    },

    replaceBars(bars: BarItem[]) {
      const series = candlestickRef.current;
      if (!series) return;
      const sorted = [...bars].sort((a, b) => a.time - b.time);
      series.setData(
        sorted.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );
      topChartRef.current?.timeScale().scrollToRealTime();
    },

    setMarkers(markers: ChartMarker[]) {
      const plugin = markersPluginRef.current;
      if (!plugin) return;
      const converted: SeriesMarker<Time>[] = markers
        .map((m) => ({
          time: m.time as Time,
          position: m.position,
          shape: m.shape,
          text: m.text ?? "",
          color: m.color ?? "#94a3b8",
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      plugin.setMarkers(converted);
    },

    reset() {
      if (candlestickRef.current) candlestickRef.current.setData([]);
      if (priceLineRef.current) priceLineRef.current.setData([]);
      if (equitySeriesRef.current) equitySeriesRef.current.setData([]);
      if (markersPluginRef.current) markersPluginRef.current.setMarkers([]);
    },
  }));

  // ── Render ─────────────────────────────────────────────

  return (
    <div ref={wrapperRef} className="w-full">
      <div ref={topContainerRef} style={{ height: heightTop }} />
      <div className="h-px bg-gray-700" />
      <div ref={bottomContainerRef} style={{ height: heightBottom }} />
    </div>
  );
});
