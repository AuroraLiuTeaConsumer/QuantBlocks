/**
 * Funding rate cost computation for backtest simulation.
 *
 * Perpetual futures convention:
 *   fundingRate > 0  →  longs pay shorts
 *   fundingRate < 0  →  shorts pay longs
 *
 * Each 8-hour funding event is applied at `fundingTime`. The backtest loop
 * calls `barFundingCost()` once per bar while a position is open.
 */

import type { FundingRate } from "../market-data/types";

/**
 * Return the total USD funding cost for one bar.
 *
 * Positive return = position paid (deducted from equity).
 * Negative return = position received (added to equity).
 *
 * @param fundingRates  All funding events for the instrument (any order — scanned linearly).
 * @param position      Current open position.
 * @param barOpenMs     Unix ms of the bar's open timestamp (inclusive).
 * @param barCloseMs    Unix ms of the bar's close timestamp (exclusive).
 * @param barClosePrice Bar close price — used as fallback when markPrice is null.
 */
export function barFundingCost(
  fundingRates: FundingRate[],
  position: { side: "long" | "short"; qty: number },
  barOpenMs: number,
  barCloseMs: number,
  barClosePrice: number,
): number {
  let total = 0;

  for (const fr of fundingRates) {
    const ft = fr.fundingTime.getTime();
    if (ft < barOpenMs || ft >= barCloseMs) continue;

    const markPrice = fr.markPrice ?? barClosePrice;
    const notional = position.qty * markPrice;

    // Long pays when rate > 0; short pays when rate < 0 (inverted)
    const payment =
      position.side === "long"
        ? notional * fr.fundingRate
        : -(notional * fr.fundingRate);

    total += payment;
  }

  return total;
}
