import { afterEach, describe, expect, it, vi } from "vitest";
import { markets, normalizeCandles, request } from "../src/lib/api";
import { INTERVAL } from "../src/lib/types";
const t = Date.UTC(2026, 0, 1),
  row = (time: number) => [String(time), "100", "102", "98", "101", "1000"];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("actual API data normalization", () => {
  it("sorts and deduplicates timestamps", () => {
    const out = normalizeCandles(
      [row(t + INTERVAL), row(t), row(t)],
      t + 2 * INTERVAL,
    );
    expect(out.map((c) => c.time)).toEqual([t, t + INTERVAL]);
  });
  it("excludes unclosed candles", () => {
    expect(
      normalizeCandles([row(t), row(t + INTERVAL)], t + INTERVAL + 1),
    ).toHaveLength(1);
  });
  it("includes a bar only when its close time is reached", () =>
    expect(normalizeCandles([row(t)], t + INTERVAL)).toHaveLength(1));
  it("rejects missing intervals", () =>
    expect(() =>
      normalizeCandles([row(t), row(t + 2 * INTERVAL)], t + 4 * INTERVAL),
    ).toThrow("결측"));
  it("rejects malformed OHLCV and conflicting duplicates", () => {
    expect(() =>
      normalizeCandles([[t, 100, 99, 98, 101, 2]], t + INTERVAL),
    ).toThrow("이상치");
    expect(() =>
      normalizeCandles([row(t), [t, 100, 103, 98, 101, 1000]], t + INTERVAL),
    ).toThrow("충돌");
  });
});
describe("Bybit errors and universe", () => {
  const reply = (list: unknown[], extra = {}) =>
    new Response(
      JSON.stringify({ retCode: 0, time: t, result: { list, ...extra } }),
    );
  it.each([403, 429])("stops on HTTP %i", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status })),
    );
    await expect(request("/x", {})).rejects.toMatchObject({ fatal: true });
  });
  it("handles invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("html")));
    await expect(request("/x", {})).rejects.toThrow("JSON");
  });
  it("handles rate limit retCode", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ retCode: 10006, retMsg: "Too many visits" }),
          ),
        ),
    );
    await expect(request("/x", {})).rejects.toMatchObject({ fatal: true });
  });
  it("handles other retCode errors without hiding details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ retCode: 10001, retMsg: "bad parameter" }),
          ),
        ),
    );
    await expect(request("/x", {})).rejects.toThrow("10001");
  });
  it("distinguishes timeout errors", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("Timed out", "TimeoutError")),
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(request("/x", {})).rejects.toThrow("시간 초과");
  });
  it("paginates and excludes BTC/ETH, non-USDT, non-perpetual, non-trading, and low turnover", async () => {
    const instrument = (symbol: string, extra = {}) => ({
      symbol,
      symbolType: "",
      quoteCoin: "USDT",
      settleCoin: "USDT",
      status: "Trading",
      contractType: "LinearPerpetual",
      ...extra,
    });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(
          [
            instrument("BTCUSDT"),
            instrument("ETHUSDT"),
            instrument("SOLUSDT"),
            instrument("WRONGUSDT", { quoteCoin: "USDC" }),
          ],
          { nextPageCursor: "next" },
        ),
      )
      .mockResolvedValueOnce(
        reply([
          instrument("XRPUSDT"),
          instrument("LOWUSDT"),
          instrument("FUTUSDT", { contractType: "LinearFutures" }),
          instrument("OLDUSDT", { status: "Settling" }),
        ]),
      )
      .mockResolvedValueOnce(
        reply(
          [
            "BTCUSDT",
            "ETHUSDT",
            "SOLUSDT",
            "XRPUSDT",
            "LOWUSDT",
            "WRONGUSDT",
            "FUTUSDT",
            "OLDUSDT",
          ].map((symbol) => ({
            symbol,
            lastPrice: "10",
            turnover24h: symbol === "LOWUSDT" ? "9000000" : "15000000",
          })),
        ),
      );
    vi.stubGlobal("fetch", mock);
    expect((await markets(10000000)).map((m) => m.symbol).sort()).toEqual([
      "SOLUSDT",
      "XRPUSDT",
    ]);
    expect(mock.mock.calls[1][0]).toContain("cursor=next");
  });
});
