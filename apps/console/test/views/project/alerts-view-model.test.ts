import { describe, expect, it } from 'vitest';
import {
  buildAlertsView,
  instanceStateLabel,
  ruleSectionToItems,
  ruleStateLabel,
} from '../../../src/views/project/alerts-view-model.js';
import type { AlertInstanceSummary, AlertRuleSummary } from '../../../src/monitoring/queries.js';

const rule: AlertRuleSummary = {
  ruleId: 'rule_1',
  name: '错误数量过高',
  metric: 'error_count',
  windowMinutes: 5,
  triggerThreshold: 100,
  recoveryThreshold: 60,
  recipientAccountIds: ['account_1'],
  evaluation: { state: 'normal', observedValue: 12 },
  version: 1,
};

const instance: AlertInstanceSummary = {
  instanceId: 'instance_1',
  ruleId: 'rule_1',
  metric: 'error_count',
  state: 'triggered',
  triggeredAt: '2026-08-10T08:30:00.000Z',
};

describe('buildAlertsView', () => {
  it('keeps rules and instances independent when one section is missing', () => {
    const view = buildAlertsView({
      loading: false,
      error: null,
      rules: { status: 'available', data: { items: [rule] } },
      instances: null,
    });
    expect(view.rules).toEqual({ kind: 'available', data: [rule] });
    expect(view.instances.kind).toBe('unavailable');
  });

  it('does not let an instance failure turn the rules section into normal', () => {
    const view = buildAlertsView({
      loading: false,
      error: '实例查询失败',
      rules: { status: 'available', data: { items: [rule] } },
      instances: {
        status: 'available',
        data: { items: [instance], count: 1, totalCountStatus: 'bounded' },
      },
    });
    // Error is page-level: both sections surface it rather than fabricating normal.
    expect(view.rules.kind).toBe('error');
    expect(view.instances.kind).toBe('error');
  });

  it('maps empty and unavailable honestly', () => {
    const view = buildAlertsView({
      loading: false,
      error: null,
      rules: { status: 'empty', reason: 'no alert rules' },
      instances: { status: 'empty', reason: 'no alert instances' },
    });
    expect(view.rules).toEqual({ kind: 'empty', reason: 'no alert rules' });
    expect(view.instances).toEqual({ kind: 'empty', reason: 'no alert instances' });
  });
});

describe('ruleSectionToItems', () => {
  it('unwraps available and never invents zero', () => {
    expect(ruleSectionToItems({ status: 'available', data: { items: [rule] } })).toEqual({
      kind: 'available',
      data: [rule],
    });
    expect(ruleSectionToItems({ status: 'unavailable', reason: 'deferred' }).kind).toBe(
      'unavailable',
    );
  });
});

describe('labels', () => {
  it('maps PRD §11.2.9 rule evaluation states', () => {
    expect(ruleStateLabel('normal')).toBe('正常');
    expect(ruleStateLabel('pending_trigger')).toBe('等待触发');
    expect(ruleStateLabel('triggered')).toBe('已触发');
    expect(ruleStateLabel('pending_recovery')).toBe('等待恢复');
    expect(ruleStateLabel('recovered')).toBe('已恢复');
    expect(ruleStateLabel('evaluation_paused')).toBe('计算暂停');
  });

  it('maps instance states with recovered as terminal', () => {
    expect(instanceStateLabel('triggered')).toBe('已触发');
    expect(instanceStateLabel('recovered')).toBe('已恢复');
    expect(instanceStateLabel('evaluation_paused')).toBe('计算暂停');
  });

  it('uses safe labels when the API returns an unknown state key', () => {
    expect(ruleStateLabel('unknown')).toBe('评估状态未知');
    expect(instanceStateLabel('unknown')).toBe('实例状态未知');
  });
});
