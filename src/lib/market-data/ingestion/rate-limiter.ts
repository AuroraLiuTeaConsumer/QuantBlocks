/**
 * Simple per-request rate limiter (sliding minimum interval).
 *
 * Enforces a minimum gap between calls so we never exceed the exchange's
 * stated request-per-minute cap. Defaults target 70% of the stated limit,
 * leaving headroom for other API calls and transient bursts.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastCallAt = 0;

  /**
   * @param requestsPerMinute  Effective cap (use ~70% of exchange's stated limit)
   */
  constructor(requestsPerMinute: number) {
    this.minIntervalMs = 60_000 / requestsPerMinute;
  }

  /** Waits if the minimum interval since the last call has not elapsed. */
  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastCallAt = Date.now();
  }
}

/**
 * Conservative rate limits (requests/min) per exchange.
 * These are ~70% of the stated limit to leave room for other API usage.
 */
export const RATE_LIMITS: Record<string, number> = {
  binance: 840, // stated: 1 200/min  → 70%
  bybit: 84, // stated: 120/min   → 70%
  okx: 140, // stated: 200/min   → 70%
  hyperliquid: 100, // conservative default
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
