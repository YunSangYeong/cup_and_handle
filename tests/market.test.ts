import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadMarketFilter,
  matchesMarket,
  saveMarketFilter,
} from "../src/lib/market";
import { filterSnapshot } from "../src/lib/scanner";
import { markets } from "../src/lib/api";
import type { Snapshot } from "../src/lib/types";
afterEach(() => vi.unstubAllGlobals());
describe("same classification as first-wave scanner", () => {
  it.each(["", "innovation"])("includes coin symbolType %j", (type) =>
    expect(matchesMarket(type, "crypto")).toBe(true),
  );
  it.each(["stock", "ETF", "commodity", "forex", "unknown", undefined])(
    "never guesses coin classification for %j",
    (type) => expect(matchesMarket(type, "crypto")).toBe(false),
  );
  it("includes only stock in stock mode", () => {
    expect(matchesMarket("stock", "stock")).toBe(true);
    for (const t of ["", "innovation", "ETF", "commodity", undefined])
      expect(matchesMarket(t, "stock")).toBe(false);
  });
  it("includes other assets and missing metadata in all mode", () => {
    for (const t of [
      "",
      "stock",
      "ETF",
      "commodity",
      "forex",
      "unknown",
      undefined,
    ])
      expect(matchesMarket(t, "all")).toBe(true);
  });
  it("defaults to crypto and safely reuses a saved valid choice", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    expect(loadMarketFilter()).toBe("crypto");
    vi.stubGlobal("localStorage", { getItem: () => "stock", setItem: vi.fn() });
    expect(loadMarketFilter()).toBe("stock");
  });
  it("falls back for corrupt settings and unavailable storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => "invalid" });
    expect(loadMarketFilter()).toBe("crypto");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    });
    expect(loadMarketFilter()).toBe("crypto");
    expect(() => saveMarketFilter("stock")).not.toThrow();
  });
});
const snapshot = (): Snapshot => ({
  version: 1,
  marketClassification: "symbolType",
  generatedAt: new Date().toISOString(),
  minTurnover: 1e7,
  targetCount: 7,
  completed: 7,
  failed: [
    { symbol: "FAILCOINUSDT", symbolType: "", message: "error" },
    { symbol: "FAILSTOCKUSDT", symbolType: "stock", message: "error" },
  ],
  entries: ["", "innovation", "stock", "ETF", undefined].map(
    (symbolType, i) => ({
      market: { symbol: `ASSET${i}USDT`, symbolType, price: 1, turnover: 3e7 },
      candles: [],
    }),
  ),
});
describe("market scope for cache and live universe", () => {
  it("scopes cache results, target counts and failures to the selected market", () => {
    expect(filterSnapshot(snapshot(), "crypto", 1e7)).toMatchObject({
      total: 3,
      completed: 3,
      errors: [{ symbol: "FAILCOINUSDT" }],
    });
    expect(filterSnapshot(snapshot(), "stock", 1e7)).toMatchObject({
      total: 2,
      completed: 2,
      entries: [{ market: { symbolType: "stock" } }],
    });
    expect(filterSnapshot(snapshot(), "all", 1e7).entries).toHaveLength(5);
  });
  it("does not invent classification for legacy caches", () => {
    const s = snapshot();
    delete s.marketClassification;
    expect(() => filterSnapshot(s, "crypto", 1e7)).toThrow("분류 정보");
    expect(() => filterSnapshot(s, "stock", 1e7)).toThrow("분류 정보");
    expect(filterSnapshot(s, "all", 1e7).entries).toHaveLength(5);
  });
  it.each([
    ["crypto", 2],
    ["stock", 1],
    ["all", 5],
  ] as const)(
    "filters official metadata before requesting candles: %s",
    async (filter, count) => {
      const assets = snapshot().entries.map((e) => e.market);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify({
                retCode: 0,
                time: Date.now(),
                result: {
                  list: url.includes("instruments-info")
                    ? assets.map((m) => ({
                        ...m,
                        quoteCoin: "USDT",
                        settleCoin: "USDT",
                        status: "Trading",
                        contractType: "LinearPerpetual",
                      }))
                    : assets.map((m) => ({
                        symbol: m.symbol,
                        turnover24h: "30000000",
                        lastPrice: "1",
                      })),
                },
              }),
            ),
        ),
      );
      const result = await markets(1e7, undefined, filter);
      expect(result).toHaveLength(count);
      expect(result.every((m) => matchesMarket(m.symbolType, filter))).toBe(
        true,
      );
    },
  );
});
