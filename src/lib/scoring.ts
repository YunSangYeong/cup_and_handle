import { ema, mean } from "./indicators";
import type { Candle, Pattern, Scores } from "./types";
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function cupScore(p: Pattern) {
  const duration = p.c.index - p.a.index,
    position = (p.b.index - p.a.index) / duration;
  return {
    "U자 바닥": 10 * clamp(p.bottomBars / (duration * 0.35)),
    "적정 깊이": 5 * clamp(1 - Math.abs(p.depth - 12) / 20),
    "고점 일치":
      5 * clamp(1 - Math.abs(p.a.price - p.c.price) / p.a.price / 0.03),
    "기간 대칭": 5 * clamp(1 - Math.abs(position - 0.5) * 2),
  };
}
export function handleScore(p: Pattern) {
  if (!p.d) return { 조정폭: 0, "상단 유지": 0, "손잡이 길이": 0 };
  const height = p.a.price - p.b.price,
    ratio = (p.c.price - p.d.price) / height;
  return {
    조정폭: 10 * clamp(1 - Math.abs(ratio - 0.18) / 0.3334),
    "상단 유지": p.d.price >= p.b.price + height / 2 ? 5 : 0,
    "손잡이 길이": p.handleBars >= 3 && p.handleBars <= 15 ? 5 : 0,
  };
}
export function volumeScore(p: Pattern) {
  return {
    "손잡이 거래량 감소":
      p.handleVolumeRatio === undefined
        ? 0
        : 10 * clamp((1 - p.handleVolumeRatio) / 0.5),
    "돌파 거래량": p.e ? 10 * clamp((p.volumeRatio ?? 0) / 1.5) : 0,
  };
}
export function breakoutScore(p: Pattern, candles: Candle[]) {
  if (!p.e) return { "확정 종가 돌파": 0, "양봉 몸통·종가 위치": 0 };
  const bar = candles[p.e.index],
    range = bar.high - bar.low;
  return {
    "확정 종가 돌파": 10,
    "양봉 몸통·종가 위치":
      range > 0
        ? 10 *
          clamp(
            (Math.max(0, bar.close - bar.open) / range +
              (bar.close - bar.low) / range) /
              2,
          )
        : 0,
  };
}
export function trendScore(candles: Candle[], end: number) {
  const closes = candles.slice(0, end + 1).map((c) => c.close),
    e50 = ema(closes, 50),
    e200 = ema(closes, 200);
  const fast = e50[end],
    slow = e200[end],
    prev = e50[end - 3];
  return {
    bullish: fast != null && slow != null ? fast > slow : null,
    rising: fast != null && prev != null ? fast > prev : null,
  };
}
export function scorePattern(
  p: Pattern,
  candles: Candle[],
  end: number,
): Scores {
  if (p.d)
    p.handleVolumeRatio =
      mean(
        candles
          .slice(p.c.index + 1, p.e?.index ?? end + 1)
          .map((c) => c.volume),
      ) /
      Math.max(
        1e-12,
        mean(candles.slice(p.a.index, p.c.index + 1).map((c) => c.volume)),
      );
  const trend = trendScore(candles, end);
  p.emaBullish = trend.bullish;
  p.emaRising = trend.rising;
  const groups = [
    cupScore(p),
    handleScore(p),
    volumeScore(p),
    breakoutScore(p, candles),
    {
      "EMA50 > EMA200": trend.bullish ? 10 : 0,
      "EMA50 상승": trend.rising ? 5 : 0,
    },
  ];
  const sums = groups.map(
    (g) => Math.round(Object.values(g).reduce((a, b) => a + b, 0) * 10) / 10,
  );
  const [cup, handle, volume, breakout, trendPoints] = sums;
  return {
    cup,
    handle,
    volume,
    breakout,
    trend: trendPoints,
    total: Math.round(sums.reduce((a, b) => a + b, 0) * 10) / 10,
    details: Object.assign({}, ...groups),
  };
}
