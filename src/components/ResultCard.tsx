import { assetLabel } from "../lib/market";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Pattern, ScanResult } from "../lib/types";
import { stageLabel } from "../lib/types";
const CandleChart = lazy(() => import("./CandleChart"));
export const fmt = (value: number | undefined, digits?: number) =>
  value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        maximumFractionDigits:
          digits ??
          (Math.abs(value) > 0 && Math.abs(value) < 1
            ? Math.min(
                12,
                Math.max(6, Math.ceil(-Math.log10(Math.abs(value))) + 3),
              )
            : 6),
      });
export const kst = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export default function ResultCard({
  result,
  pattern: p,
  chase,
}: {
  result: ScanResult;
  pattern: Pattern;
  chase: number;
}) {
  const [expanded, setExpanded] = useState(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);
  const signal = p.retest ?? p.e,
    change = p.e ? (result.price / p.e.price - 1) * 100 : undefined;
  const entryDistance = p.trade.entry
    ? (result.price / p.trade.entry - 1) * 100
    : undefined;
  const chart = (
    <Suspense fallback={<div className="chart-loading">차트 불러오는 중…</div>}>
      <CandleChart candles={result.candles} pattern={p} />
    </Suspense>
  );
  const stats = [
    ["현재 가격", fmt(result.price)],
    ["24H 거래대금", `${fmt(result.turnover / 1e6, 2)}M USDT`],
    ["컵 깊이", `${fmt(p.depth, 2)}%`],
    ["컵 기간", `${p.c.index - p.a.index}봉`],
    [
      "손잡이 조정",
      p.d
        ? `${fmt(((p.c.price - p.d.price) / (p.a.price - p.b.price)) * 100, 1)}% (컵 높이)`
        : "미완성",
    ],
    ["손잡이 기간", `${p.handleBars}봉`],
    [
      "돌파 거래량",
      p.volumeRatio !== undefined
        ? `${fmt(p.volumeRatio, 2)}×${p.volumeRatio < 1.5 ? " · 미충족" : ""}`
        : "돌파 대기",
    ],
    [
      "EMA 추세",
      p.emaBullish === null
        ? "EMA200 데이터 부족"
        : p.emaBullish
          ? "50 > 200"
          : "50 ≤ 200",
    ],
    ["패턴 시작", kst(result.candles[p.a.index].time)],
    ["신호 시각", signal ? kst(result.candles[signal.index].time) : "미발생"],
    [
      "돌파 후 변동",
      change === undefined
        ? "—"
        : `${change >= 0 ? "+" : ""}${fmt(change, 2)}%`,
    ],
    [
      "돌파 기준",
      fmt(
        p.breakoutResistance ??
          p.resistance + p.slope * (result.candles.length - 1 - p.anchor),
      ),
    ],
  ];
  return (
    <article className={`result-card stage-${p.stage}`}>
      <div className="card-top">
        <div>
          <span className={`stage-badge ${p.stage}`}>
            {stageLabel[p.stage]}
          </span>
          <h2>
            {result.symbol.replace(/USDT$/, "")}
            <small> / USDT</small>
          </h2>
          <span className="muted">
            Bybit · USDT 무기한 · {assetLabel(result.symbolType)}
          </span>
        </div>
        <div className="score">
          <strong>{fmt(p.scores.total, 1)}</strong>
          <span>/ 100 · 품질</span>
        </div>
      </div>
      {!p.e && <p className="note">돌파 전 잠정 점수 · 진입 신호 아님</p>}
      {p.volumeRatio !== undefined && p.volumeRatio < 1.5 && (
        <p className="warning">거래량 미충족: 가격 돌파만 확인되었습니다.</p>
      )}
      {entryDistance !== undefined && entryDistance >= chase && (
        <p className="warning">
          추격 위험 · 신호 진입가 대비 +{fmt(entryDistance, 2)}%
        </p>
      )}
      {result.issue && <p className="note">{result.issue}</p>}
      {chart}
      <div className="card-actions">
        <button onClick={() => setExpanded(true)}>⛶ 차트 확대</button>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BYBIT:${result.symbol}.P`)}&interval=15`}
          target="_blank"
          rel="noreferrer"
        >
          TradingView ↗
        </a>
      </div>
      <dl className="stats-grid">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="trade-grid">
        <div>
          <span>진입가</span>
          <strong>{p.trade.valid ? fmt(p.trade.entry) : "미정"}</strong>
        </div>
        <div>
          <span>손절가</span>
          <strong className="red">{fmt(p.trade.stop)}</strong>
        </div>
        <div>
          <span>TP1 · 1:2</span>
          <strong className="green">{fmt(p.trade.tp1)}</strong>
        </div>
      </div>
      <p className="muted">
        컵 높이 목표 {fmt(p.trade.target)} · 목표 손익비{" "}
        {p.trade.valid ? `1:${fmt(p.trade.rr, 2)}` : "미정"}
      </p>
      {!p.trade.valid && <p className="note">{p.trade.reason}</p>}
      <details>
        <summary>점수 세부 내역 및 단계 이력</summary>
        <div className="score-breakdown">
          {Object.entries(p.scores.details).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <b>{fmt(value, 1)}점</b>
            </div>
          ))}
        </div>
        <p className="note">
          컵 {p.scores.cup}/25 · 손잡이 {p.scores.handle}/20 · 거래량{" "}
          {p.scores.volume}/20 · 돌파 {p.scores.breakout}/20 · EMA{" "}
          {p.scores.trend}/15
        </p>
        <ol className="history">
          {p.history.map((h) => (
            <li key={`${h.stage}-${h.index}`}>
              {kst(h.time)} KST · {stageLabel[h.stage]}
            </li>
          ))}
        </ol>
        <p className="note">
          패턴 ID {result.symbol}:{p.id} · 피벗 A~D 마커는 구조 위치이며, 신호는
          확인 완료 후 E/R 시점에만 생성됩니다.
        </p>
      </details>
      <dialog
        ref={dialog}
        onCancel={() => setExpanded(false)}
        onClose={() => setExpanded(false)}
      >
        <div className="dialog-top">
          <h2>{result.symbol} · 15M</h2>
          <button onClick={() => setExpanded(false)}>닫기 ✕</button>
        </div>
        {expanded && (
          <Suspense fallback={<p>차트 로딩 중…</p>}>
            <CandleChart candles={result.candles} pattern={p} expanded />
          </Suspense>
        )}
      </dialog>
    </article>
  );
}
