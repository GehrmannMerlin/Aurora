import { describe, expect, it } from 'vitest';
import { buildIssueDetailView } from '../../../src/views/project/issue-detail-view-model.js';

const ISSUE = {
  issueId: 'issue_1',
  title: 'TypeError',
  category: 'javascript',
  fingerprintVersion: 1,
  occurrenceCount: 5,
  sampleCount: 2,
  firstSeenAt: '2026-08-09T00:00:00.000Z',
  lastSeenAt: '2026-08-10T00:00:00.000Z',
  status: 'open',
  version: 1,
};

describe('buildIssueDetailView', () => {
  it('maps available issue/samples/activity sections (each payload key)', () => {
    const view = buildIssueDetailView({
      issue: { status: 'available', data: ISSUE },
      samples: {
        status: 'available',
        items: [
          {
            sampleId: 's1',
            occurredAt: '2026-08-10T00:00:00.000Z',
            sampleKind: 'first',
            sampleBody: { message: 'x' },
          },
        ],
      },
      activity: { status: 'available', activities: [], notes: [] },
    });
    expect(view.issue).toEqual({ kind: 'available', data: ISSUE });
    expect(view.samples.kind).toBe('available');
    if (view.samples.kind === 'available') {
      expect(view.samples.data).toHaveLength(1);
    }
    expect(view.activity.kind).toBe('available');
    if (view.activity.kind === 'available') {
      expect(view.activity.data.notes).toEqual([]);
    }
  });

  it('surfaces empty and unavailable sections honestly', () => {
    const view = buildIssueDetailView({
      issue: null,
      samples: { status: 'empty', reason: 'no representative samples retained' },
      activity: { status: 'unavailable', reason: 'activity unavailable' },
    });
    expect(view.issue).toEqual({ kind: 'unavailable', reason: '详情数据源未返回结果' });
    expect(view.samples).toEqual({ kind: 'empty', reason: 'no representative samples retained' });
    expect(view.activity).toEqual({ kind: 'unavailable', reason: 'activity unavailable' });
  });

  it('does not fabricate data when an available section lacks its payload', () => {
    const view = buildIssueDetailView({
      issue: { status: 'available' },
      samples: { status: 'available' },
      activity: { status: 'available' },
    });
    expect(view.issue).toEqual({ kind: 'unavailable', reason: '详情数据缺失' });
    expect(view.samples).toEqual({ kind: 'unavailable', reason: '样本数据缺失' });
    expect(view.activity).toEqual({ kind: 'unavailable', reason: '活动数据缺失' });
  });
});
