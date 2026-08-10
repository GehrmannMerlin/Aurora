import { describe, expect, it } from 'vitest';
import {
  buildPerformanceView,
  metricLabel,
  metricUnit,
} from '../../../src/views/project/performance-view-model.js';

describe('buildPerformanceView', () => {
  it('keeps pages/percentiles honestly unavailable and surfaces metrics', () => {
    const view = buildPerformanceView({ metrics: null });
    expect(view.pages).toMatchObject({ kind: 'unavailable' });
    expect(view.percentiles).toMatchObject({ kind: 'unavailable' });
    expect(view.metrics.kind).toBe('unavailable');
  });

  it('passes an available metrics section through', () => {
    const metrics = {
      kind: 'available' as const,
      data: { metrics: [], dataThrough: '2026-08-10T00:00:00.000Z', isPartial: false },
    };
    const view = buildPerformanceView({ metrics });
    expect(view.metrics).toEqual(metrics);
  });
});

describe('metricLabel / metricUnit', () => {
  it('labels the approved metric names and units', () => {
    expect(metricLabel('lcp')).toBe('LCP');
    expect(metricLabel('inp')).toBe('INP');
    expect(metricLabel('cls')).toBe('CLS');
    expect(metricLabel('page_load')).toBe('页面加载耗时');
    expect(metricUnit('millisecond')).toBe('ms');
    expect(metricUnit('ratio')).toBe('');
  });
});
