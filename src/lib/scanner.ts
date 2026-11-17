import { ApiError, klines, markets, normalizeCandles } from "./api";
import { matchesMarket } from "./market";
import type { MarketFilter } from "./market";
import { detectPatterns } from "./detector";
import type { Failure, ScanResult, Snapshot } from "./types";
export interface Progress {
  total: number;
  completed: number;
  found: number;
  errors: Failure[];
}
export async function scan(
  minTurnover: number,
  signal: AbortSignal,
  onProgress: (p: Progress, result?: ScanResult) => void,
  marketFilter: MarketFilter = "crypto",
) {
  const internal = new AbortController();
  const combined = AbortSignal.any([signal, internal.signal]);
  const targets = await markets(minTurnover, combined, marketFilter),
    progress: Progress = {
      total: targets.length,
      completed: 0,
      found: 0,
      errors: [],
    };
  onProgress({ ...progress });
  let next = 0;
  let fatal: Error | undefined;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (next < targets.length && !signal.aborted && !fatal) {
        const market = targets[next++];
        let result: ScanResult | undefined;
        try {
          const candles = await klines(market.symbol, combined),
            patterns = detectPatterns(candles);
          result = {
            ...market,
            candles,
            patterns,
            issue:
              candles.length < 200
                ? "EMA200 데이터 부족: 추세 점수 일부 미산정"
                : undefined,
          };
          if (patterns.some((p) => !["invalid", "expired"].includes(p.stage)))
            progress.found++;
        } catch (e) {
          if (signal.aborted || internal.signal.aborted) return;
          const error = e instanceof Error ? e : new Error(String(e));
          progress.errors.push({
            symbol: market.symbol,
            symbolType: market.symbolType,
            message: error.message,
          });
          if (e instanceof ApiError && e.fatal) {
            fatal = e;
            internal.abort();
          }
        }
        progress.completed++;
        onProgress({ ...progress, errors: [...progress.errors] }, result);
        // Yield between analysis chunks so stop controls remain responsive on mobile.
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }),
  );
  if (fatal) throw fatal;
  if (signal.aborted) throw new DOMException("검색 중지", "AbortError");
  return progress;
}
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw new Error("캐시 형식 오류");
  const s = value as Snapshot;
  if (
    s.version !== 1 ||
    !Array.isArray(s.entries) ||
    !Array.isArray(s.failed) ||
    !Number.isFinite(Date.parse(s.generatedAt)) ||
    Date.parse(s.generatedAt) > Date.now() + 60000 ||
    !Number.isFinite(s.minTurnover) ||
    !Number.isInteger(s.targetCount) ||
    !Number.isInteger(s.completed)
  )
    throw new Error("캐시 메타데이터 오류");
  const symbols = new Set<string>();
  for (const e of s.entries) {
    if (
      !e.market ||
      !/^\w+USDT$/.test(e.market.symbol) ||
      ["BTCUSDT", "ETHUSDT"].includes(e.market.symbol) ||
      symbols.has(e.market.symbol) ||
      !Number.isFinite(e.market.price) ||
      e.market.price <= 0 ||
      !Number.isFinite(e.market.turnover) ||
      !Array.isArray(e.candles)
    )
      throw new Error("캐시 종목 데이터 오류");
    symbols.add(e.market.symbol);
    e.candles = normalizeCandles(
      e.candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
      Date.parse(s.generatedAt),
    );
  }
  return s;
}
export async function loadSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}data/market.json?t=${Date.now()}`,
    { signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      `캐시 없음 (HTTP ${response.status}). GitHub Actions의 Collect market data를 실행하세요.`,
    );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "캐시 JSON이 없거나 손상되었습니다. Collect market data를 실행하세요.",
    );
  }
  return validateSnapshot(data);
}

export function filterSnapshot(
  snapshot: Snapshot,
  filter: MarketFilter,
  minTurnover: number,
) {
  if (filter !== "all" && snapshot.marketClassification !== "symbolType")
    throw new Error(
      "이 캐시에 시장 분류 정보가 없습니다. 전체로 검색하거나 Collect market data를 실행해 캐시를 갱신하세요.",
    );
  const entries = snapshot.entries.filter(
    (e) =>
      e.market.turnover >= minTurnover &&
      matchesMarket(e.market.symbolType, filter),
  );
  const errors = snapshot.failed.filter((e) =>
    matchesMarket(e.symbolType, filter),
  );
  return {
    entries,
    errors,
    total:
      filter === "all" ? snapshot.targetCount : entries.length + errors.length,
    completed:
      filter === "all" ? snapshot.completed : entries.length + errors.length,
  };
}
