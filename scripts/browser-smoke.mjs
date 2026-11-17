import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.APP_URL ?? "http://127.0.0.1:5173/cup_and_handle/";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
await mkdir("/tmp/cup-scanner-checks", { recursive: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByRole("heading", { name: /CUP & HANDLE/ }).waitFor();
  await page.screenshot({
    path: "/tmp/cup-scanner-checks/desktop-empty.png",
    fullPage: true,
  });
  const apiProbe = await page.evaluate(async () => {
    try {
      const r = await fetch(
        "https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1",
        { signal: AbortSignal.timeout(20000) },
      );
      return {
        ok: r.ok,
        status: r.status,
        allowOrigin: r.headers.get("access-control-allow-origin"),
        body: (await r.text()).slice(0, 180),
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  console.log("Real browser Bybit/CORS probe:", JSON.stringify(apiProbe));
  await writeFile(
    "/tmp/cup-scanner-checks/bybit-browser-probe.json",
    JSON.stringify(apiProbe, null, 2),
  );
  // Test fixtures are intercepted exclusively in this test process; never served by the app.
  const candles = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {fixture} from './tests/fixtures.ts'; console.log(JSON.stringify(fixture({retest:true,length:241})))",
      ],
      { encoding: "utf8" },
    ),
  );
  const symbols = [
    "SOLUSDT",
    "XRPUSDT",
    "LINKUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
  ];
  await page.route("https://api.bybit.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const list = path.endsWith("instruments-info")
      ? symbols.map((symbol) => ({
          symbol,
          quoteCoin: "USDT",
          settleCoin: "USDT",
          status: "Trading",
          contractType: "LinearPerpetual",
        }))
      : path.endsWith("tickers")
        ? symbols.map((symbol) => ({
            symbol,
            lastPrice: "101.5",
            turnover24h: "35000000",
          }))
        : candles
            .slice()
            .reverse()
            .map((c) =>
              [c.time, c.open, c.high, c.low, c.close, c.volume].map(String),
            );
    await route.fulfill({
      json: { retCode: 0, time: Date.now(), result: { list } },
    });
  });
  await page.getByRole("button", { name: "⌕ 검색 시작" }).click();
  await page
    .getByText("검색 완료 · 6종목 분석 성공", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".result-card").count(), 5);
  await page.locator(".result-card").first().scrollIntoViewIfNeeded();
  await page.locator(".result-card canvas").first().waitFor();
  await page.getByRole("button", { name: "더 보기 · 5 / 6" }).click();
  assert.equal(await page.locator(".result-card").count(), 6);
  await page
    .locator(".result-card")
    .first()
    .getByRole("button", { name: "⛶ 차트 확대" })
    .click();
  await page.locator("dialog[open] canvas").first().waitFor();
  await page.getByRole("button", { name: "닫기 ✕" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".result-card").first().scrollIntoViewIfNeeded();
  await page.locator(".result-card").first().screenshot({
    path: "/tmp/cup-scanner-checks/mobile-fixture-card-test-only.png",
  });
  await page.screenshot({
    path: "/tmp/cup-scanner-checks/mobile-fixture-results-test-only.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "mobile horizontal overflow",
  );
  await page.getByLabel("패턴 단계", { exact: true }).selectOption("cup");
  assert.equal(await page.locator(".result-card").count(), 0);
  await page.getByLabel("패턴 단계", { exact: true }).selectOption("all");
  assert.equal(await page.locator(".result-card").count(), 5);
  // Verify fatal HTTP error UX; pending-request cancellation is covered by scanner tests.
  await page.unroute("https://api.bybit.com/**");
  await page.route("https://api.bybit.com/**", (route) =>
    route.fulfill({ status: 403, body: "Forbidden" }),
  );
  await page.getByRole("button", { name: "⌕ 검색 시작" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /HTTP 403/);
  assert.equal(
    await page
      .getByRole("heading", { name: "데이터 수집 상태를 확인하세요" })
      .count(),
    1,
  );
  await page.reload();
  await page.getByLabel("데이터 소스").selectOption("cache");
  await page.route("**/data/market.json?*", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.getByRole("button", { name: "⌕ 검색 시작" }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /캐시 없음/);
  await page.reload();
  await page.unroute("**/data/market.json?*");
  await page.route("**/data/market.json?*", (route) =>
    route.fulfill({
      json: {
        version: 1,
        generatedAt: new Date(candles.at(-1).time + 900000).toISOString(),
        minTurnover: 30000000,
        targetCount: 6,
        completed: 6,
        failed: [],
        entries: symbols.map((symbol) => ({
          market: { symbol, price: 101.5, turnover: 35000000 },
          candles,
        })),
      },
    }),
  );
  await page.getByLabel("데이터 소스").selectOption("cache");
  await page.getByRole("button", { name: "⌕ 검색 시작" }).click();
  await page.locator(".source-tag.cache").waitFor();
  assert.equal(await page.locator(".result-card").count(), 5);
  assert.match(await page.locator(".scan-status").innerText(), /오래된 캐시/);
  assert.match(
    await page.locator(".scan-status").innerText(),
    /수집 하한은 30M/,
  );
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/cup-scanner-checks/mobile-empty.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, [], "browser runtime errors");
  console.log(
    "PASS: mobile/desktop, 6-symbol scan, lazy canvas, expand, pagination, filters, API 403, missing cache and stale-cache re-analysis UI; fixture data only in test interception.",
  );
} finally {
  await browser.close();
}
