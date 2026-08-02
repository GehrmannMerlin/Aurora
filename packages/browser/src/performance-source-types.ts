export const BrowserPerformanceMetricName = Object.freeze({
  Lcp: 'lcp',
  Inp: 'inp',
  Cls: 'cls',
  PageLoad: 'page_load',
} as const);

export type BrowserPerformanceMetricName =
  (typeof BrowserPerformanceMetricName)[keyof typeof BrowserPerformanceMetricName];

export const BrowserPerformanceMetricUnit = Object.freeze({
  Millisecond: 'millisecond',
  Ratio: 'ratio',
} as const);

export type BrowserPerformanceMetricUnit =
  (typeof BrowserPerformanceMetricUnit)[keyof typeof BrowserPerformanceMetricUnit];

export interface BrowserPerformanceSourceEvent {
  readonly metricName: BrowserPerformanceMetricName;
  readonly value: number;
  readonly unit: BrowserPerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export type BrowserPerformanceSourceListener = (event: BrowserPerformanceSourceEvent) => void;
