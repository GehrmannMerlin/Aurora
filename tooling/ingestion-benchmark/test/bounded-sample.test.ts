import { describe, expect, it } from 'vitest';
import { BoundedSample, SAMPLE_LIMIT } from '../src/bounded-sample.js';

describe('BoundedSample', () => {
  it('summarizes a sample with count/min/max/mean/percentiles', () => {
    const sample = new BoundedSample();
    for (let i = 1; i <= 10; i += 1) sample.push(i);
    const summary = sample.toPercentiles();
    expect(summary.count).toBe(10);
    expect(summary.min).toBe(1);
    expect(summary.max).toBe(10);
    expect(summary.mean).toBeCloseTo(5.5);
    expect(summary.p50).toBe(5);
    expect(summary.p99).toBe(10);
  });

  it('throws when the limit is exceeded', () => {
    const sample = new BoundedSample(3);
    sample.push(1);
    sample.push(2);
    sample.push(3);
    expect(() => {
      sample.push(4);
    }).toThrow(/limit exceeded/);
  });

  it('throws on an empty summary', () => {
    expect(() => new BoundedSample().toPercentiles()).toThrow(/empty sample/);
  });

  it('rejects non-finite values', () => {
    const sample = new BoundedSample();
    expect(() => {
      sample.push(Number.NaN);
    }).toThrow(/finite/);
    expect(() => {
      sample.push(Infinity);
    }).toThrow(/finite/);
  });

  it('exposes SAMPLE_LIMIT as a fixed bound', () => {
    expect(SAMPLE_LIMIT).toBe(20000);
  });
});
