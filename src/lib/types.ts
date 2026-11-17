export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Market {
  symbol: string;
  turnover: number;
  price: number;
}
export type Stage =
  | "cup"
  | "handle"
  | "breakout"
  | "retest"
  | "invalid"
  | "expired";
export const stageLabel: Record<Stage, string> = {
  cup: "컵 완성",
  handle: "손잡이 형성",
  breakout: "돌파 확정",
  retest: "리테스트 성공",
  invalid: "패턴 무효",
  expired: "신호 기간 경과",
};
export interface Point {
  index: number;
  price: number;
}
export interface Transition {
  stage: Stage;
  index: number;
  time: number;
}
export interface Scores {
  cup: number;
  handle: number;
  volume: number;
  breakout: number;
  trend: number;
  total: number;
  details: Record<string, number>;
}
export interface Trade {
  entry?: number;
  stop?: number;
  tp1?: number;
  target?: number;
  rr?: number;
  valid: boolean;
  reason?: string;
}
export interface Pattern {
  id: string;
  stage: Stage;
  a: Point;
  b: Point;
  c: Point;
  d?: Point;
  e?: Point;
  retest?: Point;
  confirmedAt: number;
  signalIndex?: number;
  resistance: number;
  slope: number;
  anchor: number;
  breakoutResistance?: number;
  depth: number;
  recovery: number;
  bottomBars: number;
  handleBars: number;
  volumeRatio?: number;
  handleVolumeRatio?: number;
  scores: Scores;
  trade: Trade;
  history: Transition[];
  emaBullish: boolean | null;
  emaRising: boolean | null;
  invalidReason?: string;
}
export interface ScanResult extends Market {
  candles: Candle[];
  patterns: Pattern[];
  issue?: string;
}
export interface Failure {
  symbol: string;
  message: string;
}
export interface Snapshot {
  version: 1;
  generatedAt: string;
  minTurnover: number;
  targetCount: number;
  completed: number;
  failed: Failure[];
  entries: { market: Market; candles: Candle[] }[];
  fatal?: string;
}
export const INTERVAL = 15 * 60 * 1000;
export const rank: Record<Stage, number> = {
  retest: 4,
  breakout: 3,
  handle: 2,
  cup: 1,
  invalid: 0,
  expired: 0,
};
