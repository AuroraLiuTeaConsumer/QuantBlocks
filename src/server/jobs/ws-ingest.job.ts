#!/usr/bin/env tsx
/**
 * WebSocket live candle ingestion — Binance USDT-M futures kline stream.
 *
 * Connects to Binance's combined stream endpoint and inserts each closed candle
 * directly into TimescaleDB. Runs indefinitely; Ctrl-C to stop.
 *
 * Usage:
 *   npm run ws:ingest
 *   npm run ws:ingest -- --symbols BTCUSDT,ETHUSDT --timeframe 1m,5m,15m
 *
 * Options:
 *   --symbols    Comma-separated Binance symbols (default: BTCUSDT)
 *   --timeframe  Comma-separated kline intervals (default: 1m)
 *
 * Prerequisites:
 *   1. docker-compose up -d
 *   2. npm run setup:timescale   (creates candles hypertable)
 *
 * Implementation notes:
 *   - Uses the native WebSocket available in Node.js 22+ (no ws package needed).
 *   - Only closed candles (k.x === true) are written to the DB.
 *   - Auto-reconnects with exponential backoff (max 60 s) on unexpected close.
 *   - Inserts are idempotent: ON CONFLICT DO NOTHING in TimescaleDB.
 *   - Subscribes to the cartesian product of symbols × timeframes in one combined stream.
 *   - Each candle's timeframe is read from k.i (the payload), not a module-level variable.
 */

// Load .env before any imports that read process.env
import "./load-env";

import { getTimescaleRepo } from "../../lib/market-data/storage/timescale.repo";
import { isTimeframe, TIMEFRAMES } from "../../lib/market-data/types";
import type { Candle, Timeframe } from "../../lib/market-data/types";
import { getRedisPublisher } from "../../lib/redis/client";
import { candleChannel, encodeCandleMsg } from "../../lib/redis/channels";

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const symbolsRaw = flag("--symbols", "BTCUSDT");
  const symbols = symbolsRaw.split(",").map((s) => s.trim().toLowerCase());
  const timeframesRaw = flag("--timeframe", "1m");
  const timeframes = timeframesRaw.split(",").map((s) => s.trim());
  return { symbols, timeframes };
}

// ─── Binance stream types ─────────────────────────────────────────────────────

interface BinanceKlinePayload {
  e: "kline";
  E: number; // event time ms
  s: string; // symbol e.g. BTCUSDT
  k: {
    t: number;  // kline open time ms
    T: number;  // kline close time ms
    s: string;  // symbol
    i: string;  // interval
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;  // base asset volume
    q: string;  // quote asset volume
    n: number;  // number of trades
    x: boolean; // is candle closed?
  };
}

interface BinanceCombinedMessage {
  stream: string;
  data: BinanceKlinePayload;
}

// ─── Symbol helpers ───────────────────────────────────────────────────────────

/** "btcusdt" → "BTC/USDT:USDT" (CCXT USDT-M perp unified format) */
function binanceSymbolToCcxt(raw: string): string {
  // raw is lowercase e.g. "btcusdt"
  const upper = raw.toUpperCase(); // "BTCUSDT"
  // Strip the quote currency suffix — assume USDT pairs
  if (upper.endsWith("USDT")) {
    const base = upper.slice(0, -4);
    return `${base}/USDT:USDT`;
  }
  // Fallback — leave as-is; unlikely for the default USDT perp list
  return upper;
}

// ─── Reconnection logic ───────────────────────────────────────────────────────

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

let backoffMs = BASE_BACKOFF_MS;
let shuttingDown = false;

process.on("SIGINT", () => {
  console.log("\n[ws-ingest] SIGINT received — shutting down.");
  shuttingDown = true;
  process.exit(0);
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  process.exit(0);
});

// ─── Main ─────────────────────────────────────────────────────────────────────

function connect(symbols: string[], timeframes: string[]) {
  const streams = symbols
    .flatMap((s) => timeframes.map((tf) => `${s}@kline_${tf}`))
    .join("/");
  const url = `wss://fstream.binance.com/stream?streams=${streams}`;

  console.log(`[ws-ingest] Connecting to: ${url}`);

  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log(
      `[ws-ingest] Connected. Watching ${symbols.length} symbol(s) × ${timeframes.length} timeframe(s).`,
    );
    backoffMs = BASE_BACKOFF_MS; // reset on successful connect
  });

  ws.addEventListener("message", async (event) => {
    let msg: BinanceCombinedMessage;
    try {
      msg = JSON.parse(event.data as string) as BinanceCombinedMessage;
    } catch {
      return;
    }

    const k = msg.data?.k;
    if (!k || !k.x) return; // only process closed candles

    // Use k.i as the authoritative timeframe for this candle — the combined stream
    // carries multiple timeframes, so we cannot rely on a module-level variable.
    const tf = k.i;
    if (!isTimeframe(tf)) {
      console.warn(`[ws-ingest] Received unknown timeframe '${tf}' — skipping.`);
      return;
    }

    const ccxtSymbol = binanceSymbolToCcxt(k.s.toLowerCase());
    const openTime = new Date(k.t);
    const closeTime = new Date(k.T);

    const candle: Candle = {
      exchange: "binance",
      symbol: ccxtSymbol,
      timeframe: tf as Timeframe,
      openTime,
      closeTime,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      quoteVolume: parseFloat(k.q),
      tradeCount: k.n,
      closed: true,
    };

    try {
      const repo = getTimescaleRepo();
      const inserted = await repo.insertCandles([candle]);
      getRedisPublisher()
        .publish(
          candleChannel("binance", ccxtSymbol, tf),
          encodeCandleMsg({
            exchange: "binance",
            symbol: ccxtSymbol,
            timeframe: tf,
            openTime: candle.openTime.getTime(),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }),
        )
        .catch((err: unknown) => {
          console.warn(
            `[ws-ingest] Redis publish failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      const ts = openTime.toISOString().slice(0, 19).replace("T", " ");
      console.log(
        `[ws-ingest] ${inserted > 0 ? "✓" : "~"} ${ccxtSymbol} ${tf} ${ts} close=${candle.close}`,
      );
    } catch (err) {
      console.error("[ws-ingest] DB insert error:", err instanceof Error ? err.message : err);
    }
  });

  ws.addEventListener("error", (event) => {
    console.error("[ws-ingest] WebSocket error:", event);
  });

  ws.addEventListener("close", (event) => {
    console.log(`[ws-ingest] Connection closed (code=${event.code}).`);
    if (!shuttingDown) {
      console.log(`[ws-ingest] Reconnecting in ${backoffMs / 1000}s…`);
      setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        connect(symbols, timeframes);
      }, backoffMs);
    }
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const { symbols, timeframes } = parseArgs();

// Validate every requested timeframe against the canonical TIMEFRAMES list
const invalidTimeframes = timeframes.filter((tf) => !isTimeframe(tf));
if (invalidTimeframes.length > 0) {
  console.error(
    `[ws-ingest] Invalid timeframe(s): ${invalidTimeframes.join(", ")}. ` +
      `Valid values: ${TIMEFRAMES.join(", ")}`,
  );
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  QuantBlocks — WebSocket Live Candle Ingestion");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Symbols    : ${symbols.join(", ")}`);
console.log(`  Timeframes : ${timeframes.join(", ")}`);
console.log(`  Exchange   : Binance USDT-M futures`);
console.log("  Press Ctrl-C to stop.");
console.log("───────────────────────────────────────────────────────────\n");

connect(symbols, timeframes);
