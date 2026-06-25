#!/usr/bin/env tsx
/**
 * WebSocket live candle ingestion — Binance USDT-M futures kline stream.
 *
 * Connects to Binance's combined stream endpoint and inserts each closed candle
 * directly into TimescaleDB. Runs indefinitely; Ctrl-C to stop.
 *
 * Usage:
 *   npm run ws:ingest
 *   npm run ws:ingest -- --symbols BTCUSDT,ETHUSDT --timeframe 1m
 *
 * Options:
 *   --symbols    Comma-separated Binance symbols (default: BTCUSDT)
 *   --timeframe  Kline interval (default: 1m)
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
 */

// Load .env before any imports that read process.env
import path from "path";
import fs from "fs";

const cwd = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(cwd, f);
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^"|"$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
    break;
  }
}

import { getTimescaleRepo } from "../../lib/market-data/storage/timescale.repo";
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
  const timeframe = flag("--timeframe", "1m") as Timeframe;
  return { symbols, timeframe };
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

function connect(symbols: string[], timeframe: string) {
  const streams = symbols.map((s) => `${s}@kline_${timeframe}`).join("/");
  const url = `wss://fstream.binance.com/stream?streams=${streams}`;

  console.log(`[ws-ingest] Connecting to: ${url}`);

  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log(`[ws-ingest] Connected. Watching ${symbols.length} stream(s) @ ${timeframe}.`);
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

    const ccxtSymbol = binanceSymbolToCcxt(k.s.toLowerCase());
    const openTime = new Date(k.t);
    const closeTime = new Date(k.T);
    const tfMs = closeTime.getTime() - openTime.getTime();

    const candle: Candle = {
      exchange: "binance",
      symbol: ccxtSymbol,
      timeframe: timeframe as Timeframe,
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

    void tfMs; // suppress unused warning

    try {
      const repo = getTimescaleRepo();
      const inserted = await repo.insertCandles([candle]);
      getRedisPublisher()
        .publish(
          candleChannel("binance", ccxtSymbol, timeframe),
          encodeCandleMsg({ exchange: "binance", symbol: ccxtSymbol, timeframe, openTime: candle.openTime.getTime(), open: candle.open, high: candle.high, low: candle.low, close: candle.close }),
        )
        .catch((err: unknown) => {
          console.warn(`[ws-ingest] Redis publish failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      const ts = openTime.toISOString().slice(0, 19).replace("T", " ");
      console.log(
        `[ws-ingest] ${inserted > 0 ? "✓" : "~"} ${ccxtSymbol} ${ts} close=${candle.close}`,
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
        connect(symbols, timeframe);
      }, backoffMs);
    }
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const { symbols, timeframe } = parseArgs();

console.log("═══════════════════════════════════════════════════════════");
console.log("  QuantBlocks — WebSocket Live Candle Ingestion");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Symbols   : ${symbols.join(", ")}`);
console.log(`  Timeframe : ${timeframe}`);
console.log(`  Exchange  : Binance USDT-M futures`);
console.log("  Press Ctrl-C to stop.");
console.log("───────────────────────────────────────────────────────────\n");

connect(symbols, timeframe);
