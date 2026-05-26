/**
 * Provider registry — one instance per exchange, lazily created.
 *
 * Phase 1: all exchanges served by CCXTProvider.
 * Phase 3: hyperliquid key will be replaced by NativeHyperliquidProvider.
 */

import { CCXTProvider } from "./ccxt.provider";
import type { Exchange } from "../types";
import type { MarketDataProvider } from "./base";

const cache = new Map<Exchange, MarketDataProvider>();

export function getProvider(exchange: Exchange): MarketDataProvider {
  if (!cache.has(exchange)) {
    // Phase 3 TODO: swap in NativeHyperliquidProvider when exchange === 'hyperliquid'
    cache.set(exchange, new CCXTProvider(exchange));
  }
  return cache.get(exchange)!;
}
