import { useEffect, useMemo, useRef, useState } from "react";
import { loadSnapshot, scan } from "./lib/scanner";
import type { Progress } from "./lib/scanner";
import { detectPatterns, selectPattern } from "./lib/detector";
import { rank, stageLabel } from "./lib/types";
import type { ScanResult, Stage } from "./lib/types";
import ResultCard, { kst } from "./components/ResultCard";
const initial: Progress = { total: 0, completed: 0, found: 0, errors: [] };
export default function App() {
  const [turnover, setTurnover] = useState(10),
    [custom, setCustom] = useState("10"),
    [preset, setPreset] = useState("10");
  const [stage, setStage] = useState("all"),
    [recent, setRecent] = useState(10),
    [minimum, setMinimum] = useState(60),
    [sort, setSort] = useState("stage"),
    [chase, setChase] = useState(2);
  const [source, setSource] = useState("live"),
    [actualSource, setActualSource] = useState(""),
    [results, setResults] = useState<ScanResult[]>([]),
    [progress, setProgress] = useState<Progress>(initial),
    [running, setRunning] = useState(false),
    [status, setStatus] = useState(
      "검색을 시작하면 실제 Bybit 데이터로 패턴을 분석합니다.",
    ),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState<number>(),
    [visible, setVisible] = useState(5),
    [cacheFloor, setCacheFloor] = useState<number>();
  const controller = useRef<AbortController | null>(null),
    saved = useRef<ScanResult[]>([]);
  useEffect(() => () => controller.current?.abort(), []);
  const validSettings =
    Number.isFinite(turnover) &&
    turnover >= 0 &&
    Number.isFinite(chase) &&
    chase > 0;
  const displayed = useMemo(
    () =>
      results
        .flatMap((result) => {
          if (result.turnover < turnover * 1e6) return [];
          const candidates = result.patterns.filter(
            (p) => stage === "all" || p.stage === stage,
          );
          const pattern = selectPattern(
            candidates.filter((p) => p.scores.total >= minimum),
            result.candles.length,
            recent,
          );
          return pattern ? [{ result, pattern }] : [];
        })
        .sort((a, b) =>
          sort === "score"
            ? b.pattern.scores.total - a.pattern.scores.total
            : sort === "latest"
              ? b.result.candles[b.pattern.signalIndex ?? b.pattern.confirmedAt]
                  .time -
                a.result.candles[a.pattern.signalIndex ?? a.pattern.confirmedAt]
                  .time
              : sort === "turnover"
                ? b.result.turnover - a.result.turnover
                : rank[b.pattern.stage] - rank[a.pattern.stage] ||
                  b.pattern.scores.total - a.pattern.scores.total,
        ),
    [results, stage, minimum, recent, sort, turnover],
  );
  const invalid = results.reduce(
      (n, r) => n + r.patterns.filter((p) => p.stage === "invalid").length,
      0,
    ),
    expired = results.reduce(
      (n, r) =>
        n +
        r.patterns.filter(
          (p) =>
            p.stage === "expired" ||
            (p.stage !== "invalid" &&
              p.signalIndex !== undefined &&
              r.candles.length - 1 - p.signalIndex >= recent),
        ).length,
      0,
    );
  async function start(override?: "cache") {
    if (running || !validSettings) return;
    const ac = new AbortController();
    controller.current = ac;
    saved.current = [];
    setResults([]);
    setProgress(initial);
    setError("");
    setUpdated(undefined);
    setCacheFloor(undefined);
    setVisible(5);
    setRunning(true);
    setActualSource("");
    const mode = override ?? source;
    try {
      if (mode === "cache") {
        setStatus("공개 캐시 다운로드 및 실제 캔들 재분석 중…");
        const snapshot = await loadSnapshot(ac.signal);
        setCacheFloor(snapshot.minTurnover);
        const entries = snapshot.entries.filter(
          (e) => e.market.turnover >= turnover * 1e6,
        );
        const output: ScanResult[] = [];
        for (let i = 0; i < entries.length; i++) {
          if (ac.signal.aborted) throw new DOMException("중지", "AbortError");
          const e = entries[i];
          output.push({
            ...e.market,
            candles: e.candles,
            patterns: detectPatterns(e.candles),
            issue: e.candles.length < 200 ? "EMA200 데이터 부족" : undefined,
          });
          if (i % 8 === 0)
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        saved.current = output;
        setResults(output);
        setProgress({
          total: snapshot.targetCount,
          completed: snapshot.completed,
          found: output.filter((r) =>
            selectPattern(r.patterns, r.candles.length),
          ).length,
          errors: snapshot.failed,
        });
        setUpdated(Date.parse(snapshot.generatedAt));
        setActualSource("cache");
        setStatus(
          `캐시 분석 완료 · ${output.length}종목${snapshot.completed < snapshot.targetCount ? " · 수집 미완료" : ""}`,
        );
        if (snapshot.fatal) setError(`캐시 수집이 중단됨: ${snapshot.fatal}`);
      } else {
        setActualSource("live");
        setStatus("Bybit 종목 목록 및 거래대금 확인 중…");
        const final = await scan(turnover * 1e6, ac.signal, (p, result) => {
          setProgress(p);
          if (result) {
            saved.current.push(result);
            setResults([...saved.current]);
            setUpdated(Date.now());
          }
          setStatus(`실제 15분봉 분석 중 · ${p.completed} / ${p.total}`);
        });
        setStatus(
          final.total === 0
            ? "거래대금 조건에 맞는 대상 종목이 없습니다."
            : `검색 완료 · ${final.completed - final.errors.length}종목 분석 성공${final.errors.length ? ` · ${final.errors.length}종목 실패` : ""}`,
        );
        if (final.errors.length && final.errors.length === final.total)
          setError(
            "전체 종목 데이터 수집 실패. 아래 API 오류를 확인하세요. 결과 없음과 구분됩니다.",
          );
      }
    } catch (e) {
      if (ac.signal.aborted)
        setStatus(`검색 중지 · 분석된 ${saved.current.length}종목 유지`);
      else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(
          `수집 오류 · 정상 결과 ${saved.current.length}종목 유지. 직접 호출이 제한되면 캐시 검색을 사용하세요.`,
        );
      }
    } finally {
      setRunning(false);
      controller.current = null;
    }
  }
  const pct = progress.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;
  return (
    <div className="app-shell">
      <header className="hero">
        <div className="eyebrow">
          <span className="brand-icon">∪</span> MARKET STRUCTURE / 15M{" "}
          <span className="version">V1.0</span>
        </div>
        <h1>
          CUP &amp; HANDLE
          <br />
          <span>SCANNER</span>
          <small> V1.0</small>
        </h1>
        <p>
          Bybit USDT Perpetual <span className="dot">·</span> 15M
        </p>
        <div className="hero-note">
          확정봉으로 찾는 컵앤핸들 · 자동매매 없는 후보 탐색기
        </div>
      </header>
      <main>
        <section className="panel settings" aria-label="검색 설정">
          <div className="section-heading">
            <h2>
              <span className="green">⌕</span> 검색 설정
            </h2>
            <span className="muted">BTC · ETH 제외</span>
          </div>
          <div className="settings-grid">
            <label>
              최소 24H 거래대금
              <select
                value={preset}
                disabled={running}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setTurnover(
                    Number(
                      e.target.value === "custom" ? custom : e.target.value,
                    ),
                  );
                }}
              >
                <option value="10">10M USDT</option>
                <option value="30">30M USDT</option>
                <option value="50">50M USDT</option>
                <option value="custom">사용자 지정</option>
              </select>
            </label>
            {preset === "custom" && (
              <label>
                거래대금 (백만 USDT)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={custom}
                  disabled={running}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setTurnover(
                      e.target.value === "" ? NaN : Number(e.target.value),
                    );
                  }}
                />
              </label>
            )}
            <label>
              패턴 단계
              <select
                aria-label="패턴 단계"
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value);
                  setVisible(5);
                }}
              >
                <option value="all">전체 단계</option>
                {(["cup", "handle", "breakout", "retest"] as Stage[]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {stageLabel[s]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              최근 신호
              <select
                value={recent}
                onChange={(e) => setRecent(Number(e.target.value))}
              >
                {[3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    최근 {n}개 확정봉
                  </option>
                ))}
              </select>
            </label>
            <label>
              정렬
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="stage">신호 단계 우선</option>
                <option value="score">전체 점수순</option>
                <option value="latest">최신 신호순</option>
                <option value="turnover">거래대금순</option>
              </select>
            </label>
            <label>
              데이터 소스
              <select
                aria-label="데이터 소스"
                value={source}
                disabled={running}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="live">실시간 · Bybit 직접 호출</option>
                <option value="cache">캐시 · GitHub Actions</option>
              </select>
            </label>
            <label>
              추격 경고 기준 (%)
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={Number.isFinite(chase) ? chase : ""}
                onChange={(e) =>
                  setChase(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
            </label>
          </div>
          <div className="range-row">
            <label htmlFor="quality">
              최소 품질 점수 <strong>{minimum}점</strong>
            </label>
            <input
              id="quality"
              type="range"
              min="40"
              max="90"
              step="5"
              value={minimum}
              onChange={(e) => {
                setMinimum(Number(e.target.value));
                setVisible(5);
              }}
            />
            <span className="muted">40 — 90</span>
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={running || !validSettings}
              onClick={() => void start()}
            >
              {running ? "분석 중…" : "⌕ 검색 시작"}
            </button>
            <button
              disabled={!running}
              onClick={() => controller.current?.abort()}
            >
              ■ 중지
            </button>
            <button
              disabled={running || !validSettings}
              onClick={() => void start()}
            >
              ↻ 새로고침
            </button>
          </div>
          <p className="note">
            품질 점수는 승률이나 상승 확률이 아닙니다. 진행봉은 제외하며, API는
            최대 4개씩 요청합니다.
          </p>
        </section>
        <section className="panel scan-status" aria-live="polite">
          <div className="status-title">
            <span className={running ? "status-dot active" : "status-dot"} />
            <strong>{status}</strong>
            {actualSource && (
              <span className={`source-tag ${actualSource}`}>
                {actualSource === "cache" ? "캐시 데이터" : "실시간 API"}
              </span>
            )}
          </div>
          <div className="progress-track">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-stats">
            <span>
              대상 <b>{progress.total}</b>
            </span>
            <span>
              완료 <b>{progress.completed}</b>
            </span>
            <span>
              진행 <b>{pct}%</b>
            </span>
            <span>
              발견 <b>{progress.found}</b>
            </span>
            <span>
              오류 <b>{progress.errors.length}</b>
            </span>
          </div>
          <p className="note">
            {updated
              ? `데이터 갱신 ${kst(updated)} KST${actualSource === "cache" ? ` · ${Math.max(0, Math.round((Date.now() - updated) / 60000))}분 전 수집` : ""}`
              : "아직 수집된 데이터가 없습니다."}
            {actualSource === "cache" &&
            updated &&
            Date.now() - updated > 30 * 60000
              ? " · 오래된 캐시 주의"
              : ""}
          </p>
          {cacheFloor !== undefined && turnover * 1e6 < cacheFloor && (
            <p className="warning">
              캐시 수집 하한은 {cacheFloor / 1e6}M USDT입니다. 그 미만 종목은 이
              캐시에 없습니다.
            </p>
          )}
          {error && (
            <div className="error-box" role="alert">
              <strong>데이터 수집 오류</strong>
              <p>{error}</p>
              <button disabled={running} onClick={() => void start("cache")}>
                Actions 캐시로 검색
              </button>
            </div>
          )}
          {progress.errors.length > 0 && (
            <details>
              <summary>
                API 오류 {progress.errors.length}건 · 정상 결과는 유지됩니다
              </summary>
              <ul className="error-list">
                {progress.errors.map((e, i) => (
                  <li key={`${e.symbol}-${i}`}>
                    <b>{e.symbol}</b> {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <section className="results-section">
          <div className="section-heading">
            <h2>
              탐색 결과 <span className="result-count">{displayed.length}</span>
            </h2>
            <span className="muted">단계별 필터 · 전체 종목 분석</span>
          </div>
          <div className="summary-grid">
            {(["retest", "breakout", "handle", "cup"] as Stage[]).map((s) => (
              <button
                className={`summary ${s} ${stage === s ? "selected" : ""}`}
                key={s}
                onClick={() => {
                  setStage(stage === s ? "all" : s);
                  setVisible(5);
                }}
              >
                <span>{stageLabel[s]}</span>
                <strong>
                  {
                    results.filter((r) => {
                      const p = selectPattern(
                        r.patterns.filter((p) => p.scores.total >= minimum),
                        r.candles.length,
                        recent,
                      );
                      return r.turnover >= turnover * 1e6 && p?.stage === s;
                    }).length
                  }
                </strong>
              </button>
            ))}
          </div>
          <p className="note">
            무효 패턴 {invalid}개 · 기간 경과 {expired}개 · 분석 데이터 부족{" "}
            {progress.errors.filter((e) => e.message.includes("부족")).length}
            종목
          </p>
          {displayed.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">∪</div>
              <h3>
                {running
                  ? "시장을 분석하고 있습니다"
                  : error
                    ? "데이터 수집 상태를 확인하세요"
                    : updated
                      ? "조건에 부합하는 패턴이 발견되지 않았습니다"
                      : "다음 구조를 기다리는 시간"}
              </h3>
              <p>
                {updated
                  ? "점수·단계·최근 신호 조건을 조정하거나 새로 검색하세요."
                  : "검색을 시작하면 실제 15분봉과 패턴 구조가 여기에 표시됩니다."}
              </p>
              <span>A — B — C — D → E</span>
            </div>
          ) : (
            <div className="result-list">
              {displayed.slice(0, visible).map(({ result, pattern }) => (
                <ResultCard
                  key={`${result.symbol}:${pattern.id}`}
                  result={result}
                  pattern={pattern}
                  chase={chase}
                />
              ))}
            </div>
          )}
          {displayed.length > visible && (
            <button
              className="load-more"
              onClick={() => setVisible((v) => v + 5)}
            >
              더 보기 · {visible} / {displayed.length}
            </button>
          )}
        </section>
      </main>
      <footer>
        실제 Bybit OHLCV · 확정봉 기반 · 표시 시각 KST
        <p>
          수수료와 슬리피지는 목표가에 포함되지 않습니다. 투자 판단과 책임은
          사용자에게 있습니다.
        </p>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.
        </a>
      </footer>
    </div>
  );
}
