import { mkdir, rename, writeFile } from "node:fs/promises";
import { ApiError, klines, markets } from "../src/lib/api";
import type { Snapshot } from "../src/lib/types";
// Public OHLCV only. Never overwrite a last good snapshot when a run fails.
const minimum = Number(process.env.MIN_TURNOVER ?? 10000000);
if (!Number.isFinite(minimum) || minimum < 0)
  throw new Error("Invalid MIN_TURNOVER");
const ac = new AbortController(),
  snapshot: Snapshot = {
    version: 1,
    marketClassification: "symbolType",
    generatedAt: new Date().toISOString(),
    minTurnover: minimum,
    targetCount: 0,
    completed: 0,
    failed: [],
    entries: [],
  };
try {
  const targets = await markets(minimum, ac.signal, "all");
  snapshot.targetCount = targets.length;
  if (!targets.length)
    throw new Error("No market targets; refusing to replace cache");
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < targets.length && !ac.signal.aborted) {
        const market = targets[next++];
        try {
          const candles = await klines(market.symbol, ac.signal);
          snapshot.entries.push({ market, candles });
        } catch (e) {
          if (ac.signal.aborted) return;
          const message = e instanceof Error ? e.message : String(e);
          snapshot.failed.push({
            symbol: market.symbol,
            symbolType: market.symbolType,
            message,
          });
          if (e instanceof ApiError && e.fatal) {
            snapshot.fatal = message;
            ac.abort();
          }
        }
        snapshot.completed++;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }),
  );
  if (snapshot.fatal || !snapshot.entries.length)
    throw new Error(snapshot.fatal ?? "All markets failed");
  snapshot.entries.sort((a, b) => b.market.turnover - a.market.turnover);
  // generatedAt is capture start, so all retained candles were already closed then.
  const cutoff = Date.parse(snapshot.generatedAt);
  for (const e of snapshot.entries)
    e.candles = e.candles.filter((c) => c.time + 900000 <= cutoff);
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/market.json.tmp", JSON.stringify(snapshot));
  await rename("public/data/market.json.tmp", "public/data/market.json");
  console.log(
    `Collected ${snapshot.entries.length}/${snapshot.targetCount}; failures ${snapshot.failed.length}; ${snapshot.generatedAt}`,
  );
} catch (e) {
  console.error(
    "Collection failed; prior cache preserved:",
    e instanceof Error ? e.message : String(e),
  );
  process.exitCode = 1;
}
