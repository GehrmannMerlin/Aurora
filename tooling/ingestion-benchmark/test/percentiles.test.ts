import { describe, expect, it } from 'vitest';
import { percentile, sortNumbersAscending } from '../src/percentiles.js';

describe('percentiles', () => {
  it('throws on an empty sample', () => {
    expect(() => percentile([], 50)).toThrow(/empty sample/);
  });

  it('returns the single value for every percentile on a one-element sample', () => {
    for (const q of [50, 90, 95, 99]) {
      expect(percentile([42], q)).toBe(42);
    }
  });

  it('computes nearest-rank percentiles on an ordered sample', () => {
    // n=10, p50 = ceil(0.5*10)=5th (1-indexed) = index 4 -> 50
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 90)).toBe(90);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile(sorted, 99)).toBe(100);
  });

  it('produces identical results for unordered input', () => {
    const ordered = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const unordered = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    const sorted = sortNumbersAscending(unordered);
    expect(sorted).toEqual(ordered);
    expect(percentile(sorted, 50)).toBe(percentile(ordered, 50));
    expect(percentile(sorted, 95)).toBe(percentile(ordered, 95));
  });

  it('rejects invalid quantiles', () => {
    expect(() => percentile([1], -1)).toThrow(/invalid percentile/);
    expect(() => percentile([1], 101)).toThrow(/invalid percentile/);
    expect(() => percentile([1], Number.NaN)).toThrow(/invalid percentile/);
  });
});
