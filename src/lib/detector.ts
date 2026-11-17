import { atr, mean, pivots } from "./indicators";
import { cupScore, scorePattern } from "./scoring";
import { rank } from "./types";
import type { Candle, Pattern, Point, Stage, Trade } from "./types";
const emptyScore = {
  cup: 0,
  handle: 0,
  volume: 0,
  breakout: 0,
  trend: 0,
  total: 0,
  details: {},
};
function transition(
  p: Pattern,
  stage: Stage,
  index: number,
  candles: Candle[],
) {
  if (p.stage === stage && p.history.length) return;
  p.stage = stage;
  p.history.push({ stage, index, time: candles[index].time });
}
export function tradeLevels(p: Pattern, candles: Candle[], at: number): Trade {
  if (!p.d) return { valid: false, reason: "손잡이 미완성" };
  const volatility = atr(candles, at),
    signal = p.retest ?? p.e;
  if (volatility === undefined)
    return { valid: false, reason: "ATR 데이터 부족" };
  const stop = p.d.price - volatility * 0.2,
    target = (p.breakoutResistance ?? p.resistance) + (p.a.price - p.b.price);
  if (!signal)
    return { valid: false, stop, target, reason: "진입 미정 · 돌파 대기" };
  const entry = candles[signal.index].close,
    risk = entry - stop;
  if (stop <= 0 || risk <= 0 || risk / entry > 0.3 || risk / entry < 0.0001)
    return {
      valid: false,
      reason: "손절폭이 비정상적이거나 진입가 이하 조건 불충족",
    };
  return {
    valid: true,
    entry,
    stop,
    tp1: entry + 2 * risk,
    target,
    rr: (target - entry) / risk,
  };
}
export function resistanceAt(p: Pattern, index: number) {
  return p.resistance + p.slope * (index - p.anchor);
}
function cupCandidate(
  candles: Candle[],
  a: number,
  c: number,
): Pattern | undefined {
  const duration = c - a;
  if (duration < 30 || duration > 100) return;
  let b = a;
  for (let i = a + 1; i < c; i++) if (candles[i].low < candles[b].low) b = i;
  const A = candles[a].high,
    B = candles[b].low,
    C = candles[c].high,
    height = A - B,
    depth = (height / A) * 100;
  const bottomPosition = (b - a) / duration,
    recovery = ((C - B) / height) * 100;
  const bottomBars = candles
    .slice(a, c + 1)
    .filter((x) => x.low <= B + height * 0.15).length;
  if (
    depth < 5 ||
    depth > 25 ||
    Math.abs(C - A) / A > 0.03 ||
    recovery < 85 ||
    bottomPosition < 0.25 ||
    bottomPosition > 0.75 ||
    bottomBars < 3
  )
    return;
  return {
    id: `${candles[a].time}-${candles[c].time}`,
    stage: "cup",
    a: { index: a, price: A },
    b: { index: b, price: B },
    c: { index: c, price: C },
    confirmedAt: c + 3,
    resistance: C,
    slope: 0,
    anchor: c,
    depth,
    recovery,
    bottomBars,
    handleBars: 0,
    scores: { ...emptyScore },
    trade: { valid: false },
    history: [],
    emaBullish: null,
    emaRising: null,
  };
}
function setHandle(p: Pattern, candles: Candle[], end: number) {
  let low = p.c.index + 1;
  for (let i = low + 1; i <= end; i++)
    if (candles[i].low < candles[low].low) low = i;
  p.d = { index: low, price: candles[low].low };
  p.handleBars = end - p.c.index;
}
function validHandle(p: Pattern) {
  const h = p.a.price - p.b.price;
  return (
    !!p.d &&
    p.d.price <= p.c.price &&
    p.d.price >= p.b.price + h / 2 &&
    (p.c.price - p.d.price) / h <= 1 / 3
  );
}
function setResistance(
  p: Pattern,
  highs: number[],
  candles: Candle[],
  before: number,
) {
  const points = highs.filter((i) => i > p.c.index && i + 3 < before);
  if (points.length >= 2) {
    const [a, b] = points.slice(-2);
    p.slope = (candles[b].high - candles[a].high) / (b - a);
    p.resistance = candles[b].high;
    p.anchor = b;
  } else {
    p.slope = 0;
    p.resistance = p.c.price;
    p.anchor = p.c.index;
  }
}
/** Replay each candidate after C+3. No stage is backdated to its pivot's candle. */
export function detectPatterns(candles: Candle[]): Pattern[] {
  if (candles.length < 37) return [];
  const highs = pivots(candles, "high"),
    candidates: Pattern[] = [];
  for (const c of highs) {
    const cups = highs
      .filter((a) => a < c && c - a >= 30 && c - a <= 100)
      .map((a) => cupCandidate(candles, a, c))
      .filter((p): p is Pattern => !!p);
    // One deterministic left rim for each right rim; selection uses only data known at C+3.
    cups.sort(
      (x, y) =>
        Object.values(cupScore(y)).reduce((a, b) => a + b, 0) -
          Object.values(cupScore(x)).reduce((a, b) => a + b, 0) ||
        y.a.index - x.a.index,
    );
    if (cups[0]) candidates.push(cups[0]);
  }
  for (const p of candidates) {
    const start = p.confirmedAt;
    transition(p, "cup", start, candles);
    let contact: number | undefined,
      scoredAt = start;
    for (let t = start; t < candles.length; t++) {
      if (p.e) {
        if (candles[t].close < p.d!.price) {
          p.invalidReason = "돌파 후 손잡이 저점 아래 종가 이탈";
          transition(p, "invalid", t, candles);
          break;
        }
        if (t > p.e.index && t <= p.e.index + 10 && !p.retest) {
          const level = p.breakoutResistance!;
          if (
            contact !== undefined &&
            t > contact &&
            candles[t].close > level
          ) {
            p.retest = { index: t, price: candles[t].close };
            p.signalIndex = t;
            scoredAt = t;
            transition(p, "retest", t, candles);
          } else if (
            candles[t].low <= level * 1.003 &&
            candles[t].high >= level * 0.997
          )
            contact = t;
        }
        continue;
      }
      const previousEnd = t - 1;
      setHandle(p, candles, previousEnd);
      if (!validHandle(p)) {
        p.invalidReason = "손잡이 조정폭 또는 상단 절반 조건 위반";
        transition(p, "invalid", t, candles);
        break;
      }
      setResistance(p, highs, candles, t);
      const line = resistanceAt(p, t),
        prevLine = resistanceAt(p, t - 1);
      if (
        t > start &&
        p.handleBars >= 3 &&
        p.handleBars <= 15 &&
        candles[t].close > line * 1.001 &&
        candles[t - 1].close <= prevLine * 1.001 &&
        candles[t].low >= p.d!.price
      ) {
        p.e = { index: t, price: candles[t].close };
        p.breakoutResistance = line;
        p.signalIndex = t;
        const avg = mean(candles.slice(t - 20, t).map((c) => c.volume));
        p.volumeRatio = avg > 0 ? candles[t].volume / avg : 0;
        scoredAt = t;
        transition(p, "breakout", t, candles);
        continue;
      }
      setHandle(p, candles, t);
      if (!validHandle(p)) {
        p.invalidReason = "손잡이 조정폭 초과 또는 저점 이탈";
        transition(p, "invalid", t, candles);
        break;
      }
      if (p.handleBars > 15) {
        transition(p, "expired", t, candles);
        break;
      }
      if (t > start && p.handleBars >= 3) transition(p, "handle", t, candles);
      scoredAt = t;
    }
    p.scores = scorePattern(p, candles, scoredAt);
    p.trade = tradeLevels(p, candles, scoredAt);
  }
  return [...new Map(candidates.map((p) => [p.id, p])).values()];
}
export function selectPattern(
  patterns: Pattern[],
  length: number,
  recent = 10,
): Pattern | undefined {
  return patterns
    .filter(
      (p) =>
        p.stage !== "invalid" &&
        p.stage !== "expired" &&
        (!p.signalIndex || length - 1 - p.signalIndex < recent),
    )
    .sort(
      (a, b) =>
        rank[b.stage] - rank[a.stage] ||
        b.scores.total - a.scores.total ||
        (b.signalIndex ?? b.confirmedAt) - (a.signalIndex ?? a.confirmedAt),
    )[0];
}
export function patternPoints(p: Pattern): { label: string; point: Point }[] {
  return [
    { label: "A", point: p.a },
    { label: "B", point: p.b },
    { label: "C", point: p.c },
    ...(p.d ? [{ label: "D", point: p.d }] : []),
    ...(p.e ? [{ label: "E", point: p.e }] : []),
    ...(p.retest ? [{ label: "R", point: p.retest }] : []),
  ];
}
