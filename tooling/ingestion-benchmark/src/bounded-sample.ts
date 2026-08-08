import { percentile, sortNumbersAscending } from './percentiles.js';
import type { PercentileSummary } from './types.js';

export const SAMPLE_LIMIT = 20000;

/** Bounded exact sample collector. Pushing past the limit throws. */
export class BoundedSample {
  private readonly values: number[] = [];

  constructor(private readonly limit: number = SAMPLE_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('sample limit must be a positive safe integer');
    }
  }

  push(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(`sample value must be finite: ${String(value)}`);
    }
    if (this.values.length >= this.limit) {
      throw new Error(`sample limit exceeded: ${String(this.limit)}`);
    }
    this.values.push(value);
  }

  get size(): number {
    return this.values.length;
  }

  toPercentiles(): PercentileSummary {
    const sorted = sortNumbersAscending(this.values);
    const count = sorted.length;
    if (count === 0) {
      throw new Error('cannot summarize an empty sample');
    }
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const min = sorted[0] ?? 0;
    const max = sorted[count - 1] ?? 0;
    return {
      count,
      min,
      max,
      mean: sum / count,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }
}
