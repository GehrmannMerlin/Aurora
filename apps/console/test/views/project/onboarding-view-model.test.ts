import { describe, expect, it } from 'vitest';
import { onboardingStatusLine } from '../../../src/views/project/onboarding-view-model.js';
import type { DiagnosisSummary } from '../../../src/monitoring/diagnosis.js';

const AS_OF = '2026-08-10T00:00:00.000Z';

describe('onboardingStatusLine', () => {
  it('maps every DAT-20 summary status to an honest C1 line', () => {
    const cases: readonly [DiagnosisSummary, { label: string; tone: string }][] = [
      [
        { status: 'blocked', primaryCause: 'credential_inactive', asOf: AS_OF },
        { label: '密钥不可用', tone: 'danger' },
      ],
      [
        { status: 'not_receiving', primaryCause: 'no_credential', asOf: AS_OF },
        { label: '尚未接入', tone: 'warning' },
      ],
      [
        { status: 'not_receiving', primaryCause: 'no_received_events', asOf: AS_OF },
        { label: '暂未收到数据', tone: 'warning' },
      ],
      [
        { status: 'processing', primaryCause: 'processing_backlog', asOf: AS_OF },
        { label: '处理中', tone: 'warning' },
      ],
      [
        { status: 'receiving', asOf: AS_OF },
        { label: '已接收并处理', tone: 'success' },
      ],
      [
        { status: 'unknown', asOf: AS_OF },
        { label: '状态未知', tone: 'neutral' },
      ],
    ];
    for (const [summary, expected] of cases) {
      const line = onboardingStatusLine(summary);
      expect(line.label).toBe(expected.label);
      expect(line.tone).toBe(expected.tone);
    }
  });

  it('never uses the PRD §4.4.6 connected/connection_error/not_started labels as a status', () => {
    const forbiddenLabels = new Set<string>([
      'connected',
      'connection_error',
      'not_started',
      '接入成功',
      '接入异常',
    ]);
    for (const status of [
      'receiving',
      'processing',
      'blocked',
      'not_receiving',
      'unknown',
    ] as const) {
      const line = onboardingStatusLine({ status, asOf: AS_OF });
      expect(forbiddenLabels.has(line.label)).toBe(false);
    }
  });
});
