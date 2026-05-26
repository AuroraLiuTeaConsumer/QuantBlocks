/**
 * Provider registry — one instance per exchange, lazily created.
 *
 * Phase 1: Binance/Bybit/OKX served by CCXTProvider.
 * Phase 3: Hyperliquid served by NativeHyperliquidProvider (native REST, no CCXT).
 */

import { CCXTProvider } from "./ccxt.provider";
import { NativeHyperliquidProvider } from "./hyperliquid.provider";
import type { Exchange } from "../types";
import type { MarketDataProvider } from "./base";

const cache = new Map<Exchange, MarketDataProvider>();

export function getProvider(exchange: Exchange): MarketDataProvider {
  if (!cache.has(exchange)) {
    const provider: MarketDataProvider =
      exchange === "hyperliquid"
        ? new NativeHyperliquidProvider()
        : new CCXTProvider(exchange);
    cache.set(exchange, provider);
  }
  return cache.get(exchange)!;
}
