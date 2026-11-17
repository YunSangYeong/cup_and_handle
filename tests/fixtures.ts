import type { Candle } from "../src/lib/types";
import { INTERVAL } from "../src/lib/types";
// Synthetic data is confined to tests; never shipped as market/cache data.
export const A = 170,
  C = 230,
  E = 238,
  R = 240;
export function fixture({
  shape = "u",
  depth = 10,
  right = 100,
  breakout = true,
  volume = 300,
  retest = false,
  length = 239,
}: {
  shape?: "u" | "v";
  depth?: number;
  right?: number;
  breakout?: boolean;
  volume?: number;
  retest?: boolean;
  length?: number;
} = {}): Candle[] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length }, (_, i) => {
    let high = 99,
      low = 98,
      open = 98.5,
      close = 98.7,
      vol = 100;
    if (i >= A && i <= C) {
      const x = (i - A) / (C - A),
        bottom =
          shape === "u" ? Math.sin(Math.PI * x) : 1 - Math.abs(x * 2 - 1);
      high = 100 - depth * bottom + (right - 100) * x;
      low = high - 0.8;
      open = high - 0.4;
      close = high - 0.3;
    }
    if (i > C) {
      high = 99;
      low = 97.8;
      open = 98.6;
      close = 98.4;
      vol = 60;
    }
    if (breakout && i === E) {
      high = 102;
      low = 98;
      open = 99.5;
      close = 101.2;
      vol = volume;
    }
    if (breakout && i > E) {
      high = 102;
      low = 100.8;
      open = 101.2;
      close = 101.5;
      vol = 100;
    }
    if (retest && i === E + 1) {
      high = 101.1;
      low = 99.8;
      open = 100.8;
      close = 100.2;
    }
    return { time: start + i * INTERVAL, open, high, low, close, volume: vol };
  });
}
