export function candleChannel(exchange: string, symbol: string, timeframe: string): string {
  return `candles:${exchange}:${encodeURIComponent(symbol)}:${timeframe}`;
}

export function sessionChannel(sessionId: string): string {
  return `paper:session:${sessionId}`;
}

export type CandleMsg = {
  v: 1;
  exchange: string;
  symbol: string;
  timeframe: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function encodeCandleMsg(c: {
  exchange: string;
  symbol: string;
  timeframe: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}): string {
  return JSON.stringify({ v: 1, ...c });
}

export function decodeCandleMsg(raw: string): CandleMsg | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj["v"] !== 1) return null;
    if (
      typeof obj["exchange"] !== "string" ||
      typeof obj["symbol"] !== "string" ||
      typeof obj["timeframe"] !== "string" ||
      typeof obj["openTime"] !== "number" ||
      typeof obj["open"] !== "number" ||
      typeof obj["high"] !== "number" ||
      typeof obj["low"] !== "number" ||
      typeof obj["close"] !== "number"
    ) {
      return null;
    }
    return obj as unknown as CandleMsg;
  } catch {
    return null;
  }
}
