import { describe, expect, it } from 'vitest';
import {
  issueFiltersToQuery,
  issueListQuery,
  mergeIssuePage,
  parseIssueFilters,
} from '../../../src/views/project/issues-view-model.js';
import type { IssueListData } from '../../../src/monitoring/queries.js';

const WINDOW = { start: '2026-08-09T00:00:00.000Z', end: '2026-08-10T00:00:00.000Z' };

describe('parseIssueFilters', () => {
  it('parses approved filter values from the URL query', () => {
    expect(
      parseIssueFilters({ status: 'open', priority: 'high', assigneeAccountId: 'acc_1' }),
    ).toEqual({ status: 'open', priority: 'high', assigneeAccountId: 'acc_1' });
  });

  it('drops empty and unknown values (no silent broadening)', () => {
    expect(parseIssueFilters({ status: '', priority: null })).toEqual({});
    expect(parseIssueFilters({ status: ['open', 'closed'] })).toEqual({});
  });
});

describe('issueListQuery / issueFiltersToQuery', () => {
  it('builds the DAT-15 query with required timeRange and optional filters', () => {
    expect(issueListQuery({ status: 'open', priority: 'urgent' }, WINDOW)).toEqual({
      timeRange: WINDOW,
      status: 'open',
      priority: 'urgent',
    });
  });

  it('persists filters + timeRange to the URL, never the cursor', () => {
    expect(issueFiltersToQuery({ status: 'open', assigneeAccountId: 'acc_1' }, WINDOW)).toEqual({
      'timeRange[start]': WINDOW.start,
      'timeRange[end]': WINDOW.end,
      status: 'open',
      assigneeAccountId: 'acc_1',
    });
  });

  it('adds the cursor only when loading the next page', () => {
    expect(issueListQuery({}, WINDOW, 'abc').cursor).toBe('abc');
    expect(issueListQuery({}, WINDOW)).not.toHaveProperty('cursor');
  });
});

describe('mergeIssuePage', () => {
  function listData(overrides: Partial<IssueListData['issues']> = {}): IssueListData {
    return {
      issues: {
        status: 'available',
        items: [
          {
            issueId: 'issue_1',
            title: 'TypeError',
            status: 'open',
            occurrenceCount: 2,
            sampleCount: 1,
            firstSeenAt: '2026-08-09T00:00:00.000Z',
            lastSeenAt: '2026-08-10T00:00:00.000Z',
            version: 1,
          },
        ],
        pagination: { totalCount: 3, totalCountStatus: 'available' },
        ...overrides,
      },
      filters: { status: 'available' },
      summary: { status: 'available' },
      environments: { status: 'unavailable', reason: 'deferred' },
      releases: { status: 'unavailable', reason: 'deferred' },
    };
  }

  it('appends items and keeps the next cursor for pagination', () => {
    const state = mergeIssuePage(
      [],
      listData({ pagination: { totalCount: 3, totalCountStatus: 'available', nextCursor: 'c2' } }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.nextCursor).toBe('c2');
    expect(state.view).toEqual({
      kind: 'available',
      data: { totalCount: 3, totalCountStatus: 'available' },
    });
  });

  it('clears the list on empty without inventing zero', () => {
    const state = mergeIssuePage([], listData({ status: 'empty', reason: 'no issues in window' }));
    expect(state.view).toEqual({ kind: 'empty', reason: 'no issues in window' });
    expect(state.items).toEqual([]);
    expect(state.nextCursor).toBeNull();
  });

  it('reports unavailable instead of a guessed total', () => {
    const state = mergeIssuePage(
      [],
      listData({ status: 'unavailable', reason: 'evidence unavailable' }),
    );
    expect(state.view).toEqual({ kind: 'unavailable', reason: 'evidence unavailable' });
    expect(state.nextCursor).toBeNull();
  });
});
