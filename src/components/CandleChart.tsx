import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
} from "lightweight-charts";
import type {
  UTCTimestamp,
  SeriesMarker,
  AutoscaleInfo,
} from "lightweight-charts";
import { ema } from "../lib/indicators";
import { patternPoints, resistanceAt } from "../lib/detector";
import type { Candle, Pattern } from "../lib/types";
const time = (ms: number) => (ms / 1000) as UTCTimestamp;
export default function CandleChart({
  candles,
  pattern,
  expanded = false,
}: {
  candles: Candle[];
  pattern: Pattern;
  expanded?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(expanded);
  const [showEma, setShowEma] = useState(false);
  useEffect(() => {
    if (visible || !container.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !container.current || !candles.length) return;
    const chart = createChart(container.current, {
      autoSize: false,
      width: container.current.clientWidth,
      height: expanded ? 510 : 300,
      layout: {
        background: { type: ColorType.Solid, color: "#101a29" },
        textColor: "#8ea1bb",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#192638" },
        horzLines: { color: "#192638" },
      },
      rightPriceScale: {
        borderColor: "#26364a",
        scaleMargins: { top: 0.13, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#26364a",
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        locale: "ko-KR",
        timeFormatter: (t: number) =>
          new Date(t * 1000).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
      },
    });
    const precision = Math.max(
      2,
      Math.min(12, 3 - Math.floor(Math.log10(candles.at(-1)!.close))),
    );
    const series = chart.addSeries(CandlestickSeries, {
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        if (info?.priceRange && pattern.trade.valid) {
          info.priceRange.minValue = Math.min(
            info.priceRange.minValue,
            pattern.trade.stop!,
          );
          info.priceRange.maxValue = Math.max(
            info.priceRange.maxValue,
            pattern.trade.tp1!,
          );
        }
        return info;
      },
      upColor: "#38d9ad",
      downColor: "#f5788b",
      borderVisible: false,
      wickUpColor: "#38d9ad",
      wickDownColor: "#f5788b",
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    series.setData(candles.map((c) => ({ ...c, time: time(c.time) })));
    const volumes = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumes
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumes.setData(
      candles.map((c) => ({
        time: time(c.time),
        value: c.volume,
        color: c.close >= c.open ? "#38d9ad55" : "#f5788b55",
      })),
    );
    const colors: Record<string, string> = {
      A: "#c9b5ff",
      B: "#ffbe6b",
      C: "#c9b5ff",
      D: "#ffbe6b",
      E: "#38d9ad",
      R: "#73b6ff",
    };
    const markers: SeriesMarker<UTCTimestamp>[] = patternPoints(pattern)
      .sort((a, b) => a.point.index - b.point.index)
      .map(({ label, point }) => ({
        time: time(candles[point.index].time),
        position: ["B", "D", "R"].includes(label) ? "belowBar" : "aboveBar",
        shape: label === "E" ? "arrowUp" : "circle",
        color: colors[label],
        text: label,
      }));
    createSeriesMarkers(series, markers);
    const priceLine = (price: number, title: string, color: string) =>
      series.createPriceLine({
        price,
        title: expanded ? title : "",
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
      });
    priceLine(pattern.a.price, "컵 상단", "#b29ae7");
    const line = chart.addSeries(LineSeries, {
      color: "#e8b763",
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const start = pattern.c.index,
      end = candles.length - 1;
    line.setData([
      { time: time(candles[start].time), value: resistanceAt(pattern, start) },
      { time: time(candles[end].time), value: resistanceAt(pattern, end) },
    ]);
    if (pattern.breakoutResistance)
      priceLine(pattern.breakoutResistance, "돌파 기준 (고정)", "#e8b763");
    if (pattern.trade.valid) {
      priceLine(pattern.trade.entry!, "진입", "#73b6ff");
      priceLine(pattern.trade.stop!, "손절", "#f5788b");
      priceLine(pattern.trade.tp1!, "TP1 · 2R", "#38d9ad");
    }
    if (showEma)
      for (const [period, color] of [
        [50, "#83afff"],
        [200, "#ef99dc"],
      ] as const) {
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(
          ema(
            candles.map((c) => c.close),
            period,
          ).flatMap((value, i) =>
            value === null ? [] : [{ time: time(candles[i].time), value }],
          ),
        );
      }
    const fit = () =>
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, pattern.a.index - 10),
        to: candles.length + 2,
      });
    const frame = requestAnimationFrame(fit);
    let firstResize = true;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        const range = chart.timeScale().getVisibleLogicalRange();
        chart.applyOptions({ width });
        if (firstResize || !range) fit();
        else chart.timeScale().setVisibleLogicalRange(range);
        firstResize = false;
      }
    });
    observer.observe(container.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.remove();
    };
  }, [candles, pattern, visible, showEma, expanded]);
  return (
    <>
      <div className="chart-tools">
        <span>15M · 실제 OHLCV · 시간 KST</span>
        <label>
          <input
            type="checkbox"
            checked={showEma}
            onChange={(e) => setShowEma(e.target.checked)}
          />{" "}
          EMA50 / 200
        </label>
      </div>
      <div
        ref={container}
        className="chart"
        style={{ minHeight: expanded ? 510 : 300 }}
        aria-label="실제 15분봉 캔들 및 거래량 차트"
      >
        {!visible && <span>차트 로딩 대기</span>}
      </div>
      <div className="chart-legend">
        <span className="purple">● A·C 컵 고점</span>
        <span className="gold">● B·D 저점</span>
        <span className="green">↑ E 돌파</span>
        <span className="blue">● R 리테스트</span>
        <span className="purple">┄ 컵 상단</span>
        <span className="gold">━ 손잡이 저항</span>
        {pattern.e && <span className="gold">┄ 돌파 기준 고정</span>}
        {pattern.trade.valid && (
          <>
            <span className="blue">┄ 진입</span>
            <span className="red">┄ 손절</span>
            <span className="green">┄ TP1</span>
          </>
        )}
      </div>
    </>
  );
}
