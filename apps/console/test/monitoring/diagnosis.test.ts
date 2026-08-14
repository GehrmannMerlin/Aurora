import { describe, expect, it } from 'vitest';
import {
  actionTargetHref,
  actionTargetLabel,
  summaryDisplay,
  type ActionTarget,
  type DiagnosisSummary,
} from '../../src/monitoring/diagnosis.js';

describe('summaryDisplay', () => {
  it('maps every server status to a label and tone without re-deriving business state', () => {
    const cases: readonly [DiagnosisSummary, { label: string; tone: string }][] = [
      [
        { status: 'receiving', asOf: '2026-08-10T00:00:00.000Z' },
        { label: '正在接收', tone: 'success' },
      ],
      [
        { status: 'processing', asOf: '2026-08-10T00:00:00.000Z' },
        { label: '处理中', tone: 'warning' },
      ],
      [
        { status: 'blocked', asOf: '2026-08-10T00:00:00.000Z' },
        { label: '接收受阻', tone: 'danger' },
      ],
      [
        { status: 'not_receiving', asOf: '2026-08-10T00:00:00.000Z' },
        { label: '未接收', tone: 'warning' },
      ],
      [
        { status: 'unknown', asOf: '2026-08-10T00:00:00.000Z' },
        { label: '状态未知', tone: 'neutral' },
      ],
    ];
    for (const [summary, expected] of cases) {
      const display = summaryDisplay(summary);
      expect(display.label).toBe(expected.label);
      expect(display.tone).toBe(expected.tone);
    }
  });

  it('maps every primary cause to a safe Chinese reason', () => {
    const causes: readonly NonNullable<DiagnosisSummary['primaryCause']>[] = [
      'credential_inactive',
      'no_credential',
      'no_received_events',
      'processing_backlog',
    ];
    for (const cause of causes) {
      const display = summaryDisplay({
        status: 'blocked',
        primaryCause: cause,
        asOf: '2026-08-10T00:00:00.000Z',
      });
      expect(display.causeLabel).not.toBeNull();
      expect(display.causeLabel).not.toBe('');
    }
  });

  it('omits the cause when the server did not send one', () => {
    const display = summaryDisplay({ status: 'receiving', asOf: '2026-08-10T00:00:00.000Z' });
    expect(display.causeLabel).toBeNull();
  });
});

describe('actionTargetHref', () => {
  it('resolves an authorized route target to a path', () => {
    const target: ActionTarget = {
      routeId: 'project.onboarding',
      pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      query: {},
    };
    expect(actionTargetHref(target)).toBe('/organizations/org_1/projects/prj_1/onboarding');
  });

  it('returns null for an incomplete target (never fabricates a link)', () => {
    const target: ActionTarget = {
      routeId: 'project.onboarding',
      pathParams: { organizationId: 'org_1' },
      query: {},
    };
    expect(actionTargetHref(target)).toBeNull();
  });
});

describe('actionTargetLabel', () => {
  it('maps authorized monitoring targets to readable action copy', () => {
    expect(actionTargetLabel('project.issues')).toBe('查看问题列表');
    expect(actionTargetLabel('project.data-status')).toBe('打开数据诊断');
  });

  it('never exposes an unknown route key as primary action copy', () => {
    expect(actionTargetLabel('project.requests')).not.toBe('project.requests');
  });
});
