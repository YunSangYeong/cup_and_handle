import type { Candle } from "./types";
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < values.length; i++) {
    value += ((values[i] - value) * 2) / (period + 1);
    out[i] = value;
  }
  return out;
}
export function atr(
  candles: Candle[],
  end: number,
  period = 14,
): number | undefined {
  if (end < period) return;
  const tr = (i: number) =>
    Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  let value = 0;
  for (let i = 1; i <= period; i++) value += tr(i) / period;
  for (let i = period + 1; i <= end; i++)
    value = (value * (period - 1) + tr(i)) / period;
  return value;
}
export function pivots(
  candles: Candle[],
  side: "high" | "low",
  width = 3,
): number[] {
  const out: number[] = [];
  for (let i = width; i < candles.length - width; i++) {
    const value = candles[i][side];
    let ok = true;
    for (let j = i - width; j <= i + width; j++)
      if (
        j !== i &&
        (side === "high" ? candles[j].high > value : candles[j].low < value)
      )
        ok = false;
    // Ties use the earliest point, avoiding duplicate flat-top pivots.
    if (ok && !candles.slice(i - width, i).some((c) => c[side] === value))
      out.push(i);
  }
  return out;
}
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
