/**
 * Rolling window utilities. All functions are pure — return new arrays/values,
 * never mutate inputs.
 */

/** Return a new window with `value` appended and capped at `size` items. */
export function appendWindow(window: number[], value: number, size: number): number[] {
  const next = [...window, value];
  return next.length > size ? next.slice(next.length - size) : next;
}

export function rollingSum(window: number[]): number {
  let s = 0;
  for (const v of window) s += v;
  return s;
}

export function rollingMean(window: number[]): number {
  return window.length === 0 ? 0 : rollingSum(window) / window.length;
}

/** Population standard deviation. */
export function rollingStddev(window: number[], mean?: number): number {
  if (window.length < 2) return 0;
  const m = mean ?? rollingMean(window);
  let variance = 0;
  for (const v of window) variance += (v - m) ** 2;
  return Math.sqrt(variance / window.length);
}

export function rollingMax(window: number[]): number {
  if (window.length === 0) return 0;
  return Math.max(...window);
}

export function rollingMin(window: number[]): number {
  if (window.length === 0) return 0;
  return Math.min(...window);
}
