import { matchesMarket } from "./market";
import type { MarketFilter } from "./market";
import { INTERVAL } from "./types";
import type { Candle, Market } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public fatal = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const API = "https://api.bybit.com";
export async function request(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ list: unknown[]; nextPageCursor?: string; time: number }> {
  let response: Response;
  const timeout = AbortSignal.timeout(15000),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    response = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      signal: combined,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(
      timeout.aborted
        ? "요청 시간 초과 (15초)"
        : "Bybit 연결 실패: 네트워크·CORS 또는 지역 제한을 확인하세요.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      `Bybit HTTP ${response.status}${response.status === 403 ? " · 지역 또는 접근 제한" : ""}`,
      response.status === 429 || response.status === 403,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("Bybit 응답이 올바른 JSON이 아닙니다.");
  }
  if (data.retCode !== 0)
    throw new ApiError(
      `Bybit retCode ${data.retCode}: ${String(data.retMsg).slice(0, 150)}`,
      [10006, 10009, 10010, 10429].includes(data.retCode),
    );
  if (!Array.isArray(data.result?.list) || !Number.isFinite(Number(data.time)))
    throw new ApiError("Bybit 응답 구조 또는 서버 시각 오류");
  return { ...data.result, time: Number(data.time) };
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object") throw new ApiError("잘못된 API 항목");
  return v as Record<string, unknown>;
};
export async function markets(
  minTurnover: number,
  signal?: AbortSignal,
  marketFilter: MarketFilter = "crypto",
): Promise<Market[]> {
  const instruments = new Map<string, string | undefined>();
  let cursor = "";
  const seen = new Set<string>();
  do {
    const page = await request(
      "/v5/market/instruments-info",
      {
        category: "linear",
        limit: "1000",
        status: "Trading",
        ...(cursor ? { cursor } : {}),
      },
      signal,
    );
    for (const item of page.list) {
      const r = record(item);
      if (
        r.quoteCoin === "USDT" &&
        r.settleCoin === "USDT" &&
        r.contractType === "LinearPerpetual" &&
        r.status === "Trading" &&
        typeof r.symbol === "string" &&
        !["BTCUSDT", "ETHUSDT"].includes(r.symbol)
      )
        instruments.set(
          r.symbol,
          typeof r.symbolType === "string" ? r.symbolType : undefined,
        );
    }
    cursor = page.nextPageCursor ?? "";
    if (cursor && seen.has(cursor))
      throw new ApiError("종목 페이지네이션 커서 반복");
    seen.add(cursor);
  } while (cursor);
  const tickers = await request(
    "/v5/market/tickers",
    { category: "linear" },
    signal,
  );
  return tickers.list
    .map((item) => {
      const r = record(item);
      return {
        symbol: String(r.symbol),
        symbolType: instruments.get(String(r.symbol)),
        price: Number(r.lastPrice),
        turnover: Number(r.turnover24h),
      };
    })
    .filter(
      (m) =>
        instruments.has(m.symbol) &&
        matchesMarket(m.symbolType, marketFilter) &&
        Number.isFinite(m.turnover) &&
        m.turnover >= minTurnover &&
        Number.isFinite(m.price) &&
        m.price > 0,
    )
    .sort((a, b) => b.turnover - a.turnover);
}
export function normalizeCandles(rows: unknown[], now: number): Candle[] {
  const unique = new Map<number, Candle>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6)
      throw new ApiError("캔들 데이터 형식 오류");
    const [time, open, high, low, close, volume] = row.map(Number);
    if (
      ![time, open, high, low, close, volume].every(Number.isFinite) ||
      time % INTERVAL !== 0 ||
      time <= 0 ||
      Math.min(open, high, low, close) <= 0 ||
      volume < 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close, high)
    )
      throw new ApiError("캔들 OHLCV 이상치");
    if (time + INTERVAL > now) continue;
    const candle = { time, open, high, low, close, volume };
    const prev = unique.get(time);
    if (prev && JSON.stringify(prev) !== JSON.stringify(candle))
      throw new ApiError("동일 시각 캔들 값 충돌");
    unique.set(time, candle);
  }
  const out = [...unique.values()].sort((a, b) => a.time - b.time);
  for (let i = 1; i < out.length; i++)
    if (out[i].time - out[i - 1].time !== INTERVAL)
      throw new ApiError("15분봉 데이터 결측");
  return out;
}
const memoryCache = new Map<string, { until: number; candles: Candle[] }>();
export async function klines(
  symbol: string,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const cached = memoryCache.get(symbol);
  if (cached && cached.until > Date.now()) return cached.candles;
  const page = await request(
    "/v5/market/kline",
    { category: "linear", symbol, interval: "15", limit: "250" },
    signal,
  );
  const candles = normalizeCandles(page.list, page.time);
  if (candles.length < 37)
    throw new ApiError(`데이터 부족: 확정봉 ${candles.length}개`);
  memoryCache.set(symbol, {
    until: Math.floor(page.time / INTERVAL) * INTERVAL + INTERVAL,
    candles,
  });
  return candles;
}
