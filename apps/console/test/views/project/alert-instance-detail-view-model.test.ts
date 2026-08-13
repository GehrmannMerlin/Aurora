import { describe, expect, it } from 'vitest';
import {
  buildAlertInstanceDetailView,
  completenessLabel,
  instanceStateLabel,
} from '../../../src/views/project/alert-instance-detail-view-model.js';
import type { AlertInstanceDetailData } from '../../../src/monitoring/queries.js';

const detail: AlertInstanceDetailData = {
  instance: {
    instanceId: 'instance_1',
    ruleId: 'rule_1',
    ruleName: '错误数量过高',
    metric: 'error_count',
    state: 'evaluation_paused',
    directReason: 'evaluation_paused',
    triggeredAt: '2026-08-10T08:30:00.000Z',
    pauseReason: 'no data source',
  },
  ruleSnapshot: {
    name: '错误数量过高',
    metric: 'error_count',
    filters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
    windowMinutes: 5,
    triggerThreshold: 100,
    triggerDurationMinutes: 2,
    recoveryThreshold: 60,
    recoveryDurationMinutes: 2,
    minSampleCount: 0,
    cooldownMinutes: 10,
  },
  evidence: {
    evaluatedAt: '2026-08-10T08:30:00.000Z',
    windowStartAt: '2026-08-10T08:25:00.000Z',
    windowEndAt: '2026-08-10T08:30:00.000Z',
    completeness: 'missing',
    appliedFilters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
  },
  transitions: [
    {
      from: 'pending_trigger',
      to: 'triggered',
      reason: 'triggered',
      occurredAt: '2026-08-10T08:30:00.000Z',
    },
  ],
};

describe('buildAlertInstanceDetailView', () => {
  it('unwraps an available detail into four independent sections', () => {
    const view = buildAlertInstanceDetailView({ loading: false, error: null, detail });
    expect(view.instance).toEqual({ kind: 'available', data: detail.instance });
    expect(view.ruleSnapshot.kind).toBe('available');
    expect(view.evidence.kind).toBe('available');
    expect(view.transitions).toEqual({ kind: 'available', data: detail.transitions });
  });

  it('surfaces loading and error honestly', () => {
    expect(
      buildAlertInstanceDetailView({ loading: true, error: null, detail: null }).instance.kind,
    ).toBe('loading');
    const errorView = buildAlertInstanceDetailView({
      loading: false,
      error: '加载失败',
      detail: null,
    });
    expect(errorView.instance).toEqual({ kind: 'error', message: '加载失败' });
    expect(errorView.evidence.kind).toBe('error');
  });

  it('keeps a paused instance from being shown as recovered', () => {
    const view = buildAlertInstanceDetailView({ loading: false, error: null, detail });
    if (view.instance.kind === 'available') {
      expect(view.instance.data.state).toBe('evaluation_paused');
    }
  });
});

describe('labels', () => {
  it('maps completeness without inventing recovery', () => {
    expect(completenessLabel('complete')).toBe('数据完整');
    expect(completenessLabel('insufficient')).toBe('样本不足');
    expect(completenessLabel('missing')).toBe('数据缺失');
  });

  it('maps instance states', () => {
    expect(instanceStateLabel('triggered')).toBe('已触发');
    expect(instanceStateLabel('evaluation_paused')).toBe('计算暂停');
    expect(instanceStateLabel('recovered')).toBe('已恢复');
  });
});
