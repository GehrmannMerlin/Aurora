import { describe, expect, it } from 'vitest';
import {
  applyMetricDefaults,
  initialDraft,
  metricSwitchConflicts,
  validateLocalDraft,
} from '../../../src/views/project/alert-rule-form-view-model.js';
import type { AlertCapabilityData } from '../../../src/monitoring/queries.js';

const capability: AlertCapabilityData = {
  metrics: [
    {
      metric: 'error_count',
      displayName: 'Error count',
      unit: 'count',
      direction: 'higher_is_worse',
      isRatio: false,
      minSamplesRequired: false,
      filterDimensions: ['environment'],
    },
    {
      metric: 'request_failure_rate',
      displayName: 'Request failure rate',
      unit: 'percentage',
      direction: 'higher_is_worse',
      isRatio: true,
      minSamplesRequired: true,
      filterDimensions: ['environment'],
    },
  ],
  windowsMinutes: [1, 5, 10, 30, 60],
  triggerDurationsMinutes: [0, 1, 2, 5, 10],
  cooldownsMinutes: [5, 10, 30, 60],
  filterDimensions: [{ id: 'environment', available: false, reason: 'no source yet' }],
  recipients: [{ accountId: 'account_1', maskedEmail: 'a***@example.com' }],
};

describe('initialDraft / applyMetricDefaults', () => {
  it('starts with no metric and applies capability defaults on selection', () => {
    const draft = initialDraft();
    expect(draft.metric).toBe('');

    const selected = applyMetricDefaults(draft, 'error_count', capability);
    expect(selected.metric).toBe('error_count');
    expect(selected.windowMinutes).toBe(5);
    expect(selected.triggerDurationMinutes).toBe(2);
    expect(selected.cooldownMinutes).toBe(10);
    expect(selected.minSampleCount).toBeUndefined();
  });

  it('requires a min sample count for ratio metrics and defaults it', () => {
    const selected = applyMetricDefaults(initialDraft(), 'request_failure_rate', capability);
    expect(selected.minSampleCount).toBe(1);
    expect(selected.recoveryDurationMinutes).toBe(2);
  });

  it('keeps an existing draft value when it is already in the fixed options', () => {
    const draft = {
      ...initialDraft(),
      windowMinutes: 30,
      triggerDurationMinutes: 10,
      cooldownMinutes: 60,
    };
    const selected = applyMetricDefaults(draft, 'error_count', capability);
    expect(selected.windowMinutes).toBe(30);
    expect(selected.triggerDurationMinutes).toBe(10);
    expect(selected.cooldownMinutes).toBe(60);
  });
});

describe('metricSwitchConflicts', () => {
  it('flags minSampleCount when switching ratio -> count', () => {
    const draft = { ...initialDraft(), metric: 'request_failure_rate', minSampleCount: 1 };
    expect(metricSwitchConflicts(draft, 'error_count', capability)).toEqual(['minSampleCount']);
  });

  it('flags nothing when switching count -> ratio', () => {
    const draft = { ...initialDraft(), metric: 'error_count' };
    expect(metricSwitchConflicts(draft, 'request_failure_rate', capability)).toEqual([]);
  });
});

describe('validateLocalDraft', () => {
  it('requires a metric and returns immediately when missing', () => {
    expect(validateLocalDraft(initialDraft(), capability).metric).toBe('请选择告警指标。');
  });

  it('validates fixed options, ratio min samples and recipients', () => {
    const draft = {
      ...initialDraft(),
      metric: 'request_failure_rate',
      windowMinutes: 7,
      minSampleCount: 0,
      recipientAccountIds: [],
    };
    const errors = validateLocalDraft(draft, capability);
    expect(errors.windowMinutes).toBe('统计窗口必须是固定选项之一。');
    expect(errors.minSampleCount).toBe('比例型指标必须设置最小样本数（≥1）。');
    expect(errors.recipientAccountIds).toBe('至少选择一个接收成员。');
  });

  it('accepts a valid count-metric draft with a recipient', () => {
    const draft = {
      ...initialDraft(),
      metric: 'error_count',
      recipientAccountIds: ['account_1'],
    };
    expect(validateLocalDraft(draft, capability)).toEqual({});
  });
});
