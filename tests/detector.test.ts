import { describe, expect, it } from "vitest";
import {
  detectPatterns,
  resistanceAt,
  selectPattern,
} from "../src/lib/detector";
import { ema, pivots } from "../src/lib/indicators";
import { fixture, A, C, E, R } from "./fixtures";
const target = (data = fixture()) =>
  detectPatterns(data).find((p) => p.a.index === A && p.c.index === C);
describe("cup geometry", () => {
  it("detects a valid U cup", () => {
    const p = target();
    expect(p).toBeDefined();
    expect(p!.depth).toBeCloseTo(10.8);
    expect(p!.bottomBars).toBeGreaterThan(3);
  });
  it("penalizes a sharp V recovery", () => {
    expect(target(fixture({ shape: "v" }))!.scores.cup).toBeLessThan(
      target()!.scores.cup,
    );
  });
  it("rejects depth above 25%", () =>
    expect(target(fixture({ depth: 30 }))).toBeUndefined());
  it("rejects unequal rims", () =>
    expect(target(fixture({ right: 104 }))).toBeUndefined());
  it("rejects a bottom outside the central 25–75%", () => {
    const d = fixture();
    for (let i = A + 1; i < C; i++) {
      d[i] = { ...d[i], low: 98, high: 99, open: 98.5, close: 98.7 };
    }
    d[A + 5].low = 89;
    expect(target(d)).toBeUndefined();
  });
  it("requires at least three bars near the bottom", () => {
    const d = fixture();
    for (let i = A + 1; i < C; i++)
      d[i] = { ...d[i], low: 97, high: 99, open: 98, close: 98.5 };
    d[(A + C) / 2].low = 89;
    expect(target(d)).toBeUndefined();
  });
});
describe("handle and confirmed signals", () => {
  it("marks an excessively deep handle invalid", () => {
    const d = fixture();
    d[C + 2].low = 92;
    expect(target(d)!.stage).toBe("invalid");
  });
  it("keeps newly confirmed cup separate from a completed handle", () => {
    const p = target(fixture({ length: C + 4, breakout: false }));
    expect(p!.stage).toBe("cup");
    expect(p!.trade.valid).toBe(false);
  });
  it("detects a valid handle before breakout", () =>
    expect(target(fixture({ length: E, breakout: false }))!.stage).toBe(
      "handle",
    ));
  it("confirms volume breakout and freezes the entry", () => {
    const p = target()!;
    expect(p.stage).toBe("breakout");
    expect(p.e!.index).toBe(E);
    expect(p.volumeRatio).toBeGreaterThan(1.5);
    expect(p.trade.entry).toBe(101.2);
    expect(p.trade.tp1! - p.trade.entry!).toBeCloseTo(
      2 * (p.trade.entry! - p.trade.stop!),
    );
  });
  it("detects price breakout with insufficient volume and lower score", () => {
    const p = target(fixture({ volume: 70 }))!;
    expect(p.stage).toBe("breakout");
    expect(p.volumeRatio).toBeLessThan(1.5);
    expect(p.scores.total).toBeLessThan(target()!.scores.total);
  });
  it("confirms retest on a later closed candle", () => {
    const p = target(fixture({ retest: true, length: R + 1 }))!;
    expect(p.stage).toBe("retest");
    expect(p.retest!.index).toBe(R);
    expect(p.trade.entry).toBe(101.5);
  });
  it("does not confirm retest on the touch candle", () =>
    expect(target(fixture({ retest: true, length: E + 2 }))!.stage).toBe(
      "breakout",
    ));
  it("does not confirm failed retest", () => {
    const d = fixture({ retest: true, length: R + 1 });
    d[R] = { ...d[R], low: 98.2, close: 99 };
    expect(target(d)!.retest).toBeUndefined();
  });
  it("invalidates a close below the handle low, including after retest", () => {
    const d = fixture({ retest: true, length: R + 3 });
    d[R + 2] = { ...d[R + 2], low: 96, close: 97 };
    expect(target(d)!.stage).toBe("invalid");
  });
  it("waits for three closed right-hand pivot bars", () => {
    const d = fixture();
    expect(pivots(d.slice(0, C + 3), "high")).not.toContain(C);
    expect(target(d.slice(0, C + 3))).toBeUndefined();
    expect(pivots(d.slice(0, C + 4), "high")).toContain(C);
  });
  it("does not use future handle pivots for breakout resistance", () => {
    const d = fixture();
    d[C + 5].high = 99.9;
    const p = target(d)!;
    expect(p.e!.index).toBe(E);
    expect(p.breakoutResistance).toBe(100);
    expect(resistanceAt(p, E)).toBe(100);
  });
  it("has stable IDs and no duplicate pattern", () => {
    const patterns = detectPatterns(fixture());
    expect(new Set(patterns.map((p) => p.id)).size).toBe(patterns.length);
    expect(target(fixture({ length: R + 2, retest: true }))!.id).toBe(
      target()!.id,
    );
  });
  it("prefix replay never backdates or changes historical transitions", () => {
    const d = fixture({ retest: true, length: R + 4 });
    const final = target(d)!;
    for (let end = C + 4; end <= d.length; end++) {
      const p = target(d.slice(0, end));
      expect(p).toBeDefined();
      expect(p!.history).toEqual(final.history.filter((h) => h.index < end));
      expect(p!.history.every((h) => h.index >= C + 3)).toBe(true);
      if (end > E) {
        const reference = p!.retest ? final : target(d.slice(0, E + 1))!;
        expect(p!.trade).toEqual(reference.trade);
      }
    }
  });
  it("filters recent signals by closed-bar age", () => {
    const p = target()!;
    expect(selectPattern([p], E + 10, 10)).toBeDefined();
    expect(selectPattern([p], E + 11, 10)).toBeUndefined();
  });
  it("never awards breakout points before breakout", () => {
    const p = target(fixture({ length: E, breakout: false }))!;
    expect(p.scores.breakout).toBe(0);
    expect(p.scores.details["돌파 거래량"]).toBe(0);
    expect(p.trade.entry).toBeUndefined();
  });
});
describe("EMA availability", () => {
  it("requires 200 bars for EMA200", () => {
    expect(ema(Array(199).fill(1), 200).every((x) => x === null)).toBe(true);
    expect(ema(Array(200).fill(1), 200)[199]).toBe(1);
  });
  it("does not silently give EMA200 points without enough data", () => {
    const d = fixture().slice(100);
    const p = detectPatterns(d).find((p) => p.c.index === C - 100)!;
    expect(p.emaBullish).toBeNull();
    expect(p.scores.details["EMA50 > EMA200"]).toBe(0);
  });
});

describe("confirmed descending handle resistance", () => {
  it("uses two confirmed highs and locks their breakout-time value for retest", () => {
    const d = fixture({ breakout: false, length: C + 17 });
    d[C + 4].high = 99.6;
    d[C + 8].high = 99.4;
    d[C + 14] = {
      ...d[C + 14],
      open: 98.7,
      high: 100,
      low: 98,
      close: 99.5,
      volume: 300,
    };
    d[C + 15] = { ...d[C + 15], open: 99.3, high: 99.5, low: 99, close: 99.12 };
    d[C + 16] = { ...d[C + 16], open: 99.2, high: 100, low: 99, close: 99.6 };
    const p = target(d)!;
    expect(p.slope).toBeCloseTo(-0.05);
    expect(p.e!.index).toBe(C + 14);
    expect(p.breakoutResistance).toBeCloseTo(99.1);
    expect(p.retest!.index).toBe(C + 16);
    expect(p.stage).toBe("retest");
  });
});
