import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateSnapshot } from "../src/lib/scanner";
import { fixture } from "./fixtures";
import { INTERVAL } from "../src/lib/types";
const symbols = Array.from({ length: 12 }, (_, i) => `COIN${i}USDT`),
  candles = fixture();
function response(list: unknown[]) {
  return new Response(
    JSON.stringify({ retCode: 0, time: Date.now(), result: { list } }),
  );
}
function universe(url: string) {
  if (url.includes("instruments-info"))
    return response(
      symbols.map((symbol) => ({
        symbol,
        quoteCoin: "USDT",
        settleCoin: "USDT",
        contractType: "LinearPerpetual",
        status: "Trading",
      })),
    );
  if (url.includes("tickers"))
    return response(
      symbols.map((symbol) => ({
        symbol,
        lastPrice: "101.5",
        turnover24h: "35000000",
      })),
    );
}
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("bounded scan orchestration", () => {
  it("limits concurrent requests to four and retains normal results on individual failures", async () => {
    const { scan } = await import("../src/lib/scanner");
    let active = 0,
      max = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const first = universe(url);
        if (first) return first;
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (new URL(url).searchParams.get("symbol") === "COIN1USDT")
          return new Response("bad", { status: 500 });
        return response(
          candles
            .slice()
            .reverse()
            .map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
        );
      }),
    );
    const results: string[] = [];
    const p = await scan(
      10000000,
      new AbortController().signal,
      (_p, result) => {
        if (result) results.push(result.symbol);
      },
    );
    expect(max).toBe(4);
    expect(p.completed).toBe(12);
    expect(results).toHaveLength(11);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].symbol).toBe("COIN1USDT");
  });
  it("aborts pending requests and stops scheduling on a severe API error", async () => {
    const { scan } = await import("../src/lib/scanner");
    let started = 0,
      aborted = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: { signal: AbortSignal }) => {
        const first = universe(url);
        if (first) return first;
        started++;
        if (new URL(url).searchParams.get("symbol") === "COIN0USDT") {
          await new Promise((r) => setTimeout(r, 10));
          return new Response("", { status: 429 });
        }
        return new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => {
            aborted++;
            reject(new DOMException("Aborted", "AbortError"));
          }),
        );
      }),
    );
    await expect(
      scan(10000000, new AbortController().signal, () => {}),
    ).rejects.toThrow("429");
    expect(started).toBeLessThanOrEqual(4);
    expect(aborted).toBe(started - 1);
  });
  it("cancels in-flight requests when the user stops", async () => {
    const { scan } = await import("../src/lib/scanner");
    const ac = new AbortController();
    let started = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: { signal: AbortSignal }) => {
        const first = universe(url);
        if (first) return first;
        started++;
        if (started === 4) queueMicrotask(() => ac.abort());
        return new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      }),
    );
    await expect(scan(10000000, ac.signal, () => {})).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(started).toBe(4);
  });
});
describe("public cache validation", () => {
  const snapshot = () => ({
    version: 1,
    generatedAt: new Date(candles.at(-1)!.time + INTERVAL).toISOString(),
    minTurnover: 10000000,
    targetCount: 1,
    completed: 1,
    failed: [],
    entries: [
      {
        market: { symbol: "SOLUSDT", price: 101.5, turnover: 35000000 },
        candles: structuredClone(candles),
      },
    ],
  });
  it("validates actual OHLCV structure before re-analysis", () =>
    expect(validateSnapshot(snapshot()).entries[0].candles).toHaveLength(
      candles.length,
    ));
  it("rejects future timestamps and malformed entries", () => {
    const s = snapshot();
    s.generatedAt = "2999-01-01T00:00:00.000Z";
    expect(() => validateSnapshot(s)).toThrow("메타");
    const bad = snapshot();
    bad.entries[0].candles[0].high = -1;
    expect(() => validateSnapshot(bad)).toThrow("이상치");
  });
  it("rejects duplicate market entries", () => {
    const s = snapshot();
    s.entries.push(s.entries[0]);
    expect(() => validateSnapshot(s)).toThrow("종목");
  });
});
