export type MarketFilter = "crypto" | "stock" | "all";
export const marketLabels: Record<MarketFilter, string> = {
  crypto: "코인만",
  stock: "주식만",
  all: "전체",
};
// Same official Bybit classification as bybit-wave-scanner; never infer from a ticker name.
export function matchesMarket(
  symbolType: string | undefined,
  filter: MarketFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "stock") return symbolType === "stock";
  return symbolType === "" || symbolType === "innovation";
}
export function assetLabel(symbolType: string | undefined): string {
  if (matchesMarket(symbolType, "crypto")) return "코인";
  return (
    (
      {
        stock: "주식",
        ETF: "ETF",
        commodity: "원자재",
        forex: "외환",
      } as Record<string, string>
    )[symbolType ?? "unknown"] ?? "미분류"
  );
}
const key = "cup-scanner-market";
export function loadMarketFilter(): MarketFilter {
  try {
    const value = localStorage.getItem(key);
    if (value === "crypto" || value === "stock" || value === "all")
      return value;
  } catch {
    /* Storage may be disabled. */
  }
  return "crypto";
}
export function saveMarketFilter(value: MarketFilter) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* In-memory selection remains usable. */
  }
}
