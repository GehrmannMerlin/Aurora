/**
 * C6 性能工作区（`project.performance`）view-model（PLT-06）。
 *
 * 把 `performanceListPages`（DAT-17）的 metrics 区规范化为统一渲染状态；
 * `pages`/`percentiles` 恒 `unavailable`（页面维度无数据、percentile deferred），
 * `mean` 为真实聚合非采样外推。
 */
import type { PerformanceMetricSummary } from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

export interface PerformanceViewState {
  readonly metrics: SectionView<PerformanceMetricSummary>;
  readonly pages: SectionView<Record<string, never>>;
  readonly percentiles: SectionView<Record<string, never>>;
}

export interface PerformanceSource {
  readonly metrics: SectionView<PerformanceMetricSummary> | null;
}

export function buildPerformanceView(source: PerformanceSource): PerformanceViewState {
  return {
    metrics: source.metrics ?? { kind: 'unavailable', reason: '性能指标不可用' },
    pages: { kind: 'unavailable', reason: '页面维度数据不存在（DAT-17）' },
    percentiles: { kind: 'unavailable', reason: 'percentile 原材料 deferred（ADR-021）' },
  };
}

/** Render label for the approved metric names (PRD 5.1.9). */
export function metricLabel(name: string): string {
  if (name === 'page_load') return '页面加载耗时';
  return name.toUpperCase();
}

/** Render a unit for the approved metric units. */
export function metricUnit(unit: string): string {
  return unit === 'millisecond' ? 'ms' : '';
}
