import { readFileSync } from 'node:fs';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { requestCache } from '../../../src/api/cache.js';
import { router } from '../../../src/router/index.js';
import { pinia } from '../../../src/stores/index.js';
import { useSessionStore } from '../../../src/stores/session.js';
import { handlerControls } from '../../../src/mocks/handlers.js';
import ProjectIssueDetailView from '../../../src/views/project/ProjectIssueDetailView.vue';
import ProjectIssuesView from '../../../src/views/project/ProjectIssuesView.vue';
import ProjectRequestsView from '../../../src/views/project/ProjectRequestsView.vue';
import { mockServer } from '../../msw/server.js';

const issuesSource = readFileSync('src/views/project/ProjectIssuesView.vue', 'utf8');
const issueDetailSource = readFileSync('src/views/project/ProjectIssueDetailView.vue', 'utf8');
const requestsSource = readFileSync('src/views/project/ProjectRequestsView.vue', 'utf8');
const performanceSource = readFileSync('src/views/project/ProjectPerformanceView.vue', 'utf8');

describe('investigation workspace presentation', () => {
  it('keeps C3 query controls above a bordered result surface and makes current-page selection explicit', () => {
    const headerIndex = issuesSource.indexOf('<AppPageHeader');
    const toolbarIndex = issuesSource.indexOf('data-testid="issues-query-toolbar"');
    const resultsIndex = issuesSource.indexOf('data-testid="issues-results-surface"');

    expect(headerIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeGreaterThan(headerIndex);
    expect(resultsIndex).toBeGreaterThan(toolbarIndex);
    expect(issuesSource).toContain('data-testid="issues-selection-summary"');
    expect(issuesSource).toContain('data-testid="issues-selection-bar"');
    expect(issuesSource).toContain('AppTechnicalDetails');
  });

  it('groups C4 identity, lifecycle actions, evidence, representative samples, technical facts, and activity', () => {
    for (const target of [
      'issue-identity',
      'issue-lifecycle-actions',
      'issue-evidence',
      'issue-samples',
      'issue-technical-details',
      'issue-activity',
    ]) {
      expect(issueDetailSource).toContain(`data-testid="${target}"`);
    }
    expect(issueDetailSource).toContain('AppTechnicalDetails');
  });

  it('uses list-detail evidence workspaces for C5 and C6 without decorative charts', () => {
    for (const source of [requestsSource, performanceSource]) {
      expect(source).toContain('class="investigation-workspace"');
      expect(source).toContain('data-testid="investigation-list"');
      expect(source).toContain('data-testid="investigation-detail"');
      expect(source).not.toContain('<canvas');
      expect(source).not.toMatch(/<svg[^>]+role=["']img["']/);
    }
    expect(requestsSource).toContain('data-testid="requests-series-unavailable"');
    expect(performanceSource).toContain('data-testid="performance-series-unavailable"');
  });
});

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});

beforeEach(async () => {
  requestCache.clear();
  handlerControls.sessionAuthenticated = true;
  useSessionStore(pinia).reset();
  await useSessionStore(pinia).restore();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
});

afterAll(() => {
  mockServer.close();
});

async function renderIssues(): Promise<void> {
  await router.push('/organizations/org_test_1/projects/prj_test_1/issues');
  await router.isReady();
  render(ProjectIssuesView, { global: { plugins: [pinia, router] } });
}

async function renderIssueDetail(): Promise<void> {
  await router.push('/organizations/org_test_1/projects/prj_test_1/issues/issue_test_1');
  await router.isReady();
  render(ProjectIssueDetailView, { global: { plugins: [pinia, router] } });
}

describe('investigation workspace rendered behavior', () => {
  it('clears current-page issue selection before requesting the next page', async () => {
    let calls = 0;
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/projects/:projectId/issues', () => {
        calls += 1;
        return HttpResponse.json(
          issueListResponse(calls === 1 ? { nextCursor: 'cursor_2' } : {}) as JsonBodyType,
        );
      }),
    );

    await renderIssues();
    const selection = await screen.findByRole('checkbox', { name: /选择问题/ });
    await fireEvent.click(selection);
    expect(screen.getByTestId('issues-selection-summary').textContent).toContain('已选择 1 个问题');

    await fireEvent.click(screen.getByTestId('issues-load-more'));
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    expect(screen.getByTestId('issues-selection-summary').textContent).toContain('已选择 0 个问题');
  });

  it('clears current-page issue selection before a failed next-page request', async () => {
    let calls = 0;
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/projects/:projectId/issues', () => {
        calls += 1;
        if (calls === 2) return HttpResponse.json({ code: 'service_unavailable' }, { status: 503 });
        return HttpResponse.json(issueListResponse({ nextCursor: 'cursor_2' }) as JsonBodyType);
      }),
    );

    await renderIssues();
    await fireEvent.click(await screen.findByRole('checkbox', { name: /选择问题/ }));
    await fireEvent.click(screen.getByTestId('issues-load-more'));
    await waitFor(() => {
      expect(calls).toBe(2);
    });
    expect(screen.getByTestId('issues-selection-summary').textContent).toContain('已选择 0 个问题');
  });

  it('keeps raw C3 and C4 identifiers inside technical disclosure rather than primary evidence', async () => {
    mockServer.use(
      http.get('/api/platform/v1/organizations/:organizationId/projects/:projectId/issues', () =>
        HttpResponse.json(
          issueListResponse({ assigneeAccountId: 'acct_opaque_1' }) as JsonBodyType,
        ),
      ),
      http.get(
        '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId',
        () => HttpResponse.json(issueDetailResponse() as JsonBodyType),
      ),
    );

    await renderIssues();
    const issueRow = (await screen.findByTestId('issue-list')).firstElementChild;
    expect(issueRow?.querySelector('.mon-issue-meta')?.textContent).not.toContain('acct_opaque_1');
    expect(issueRow?.querySelector('.mon-issue-meta')?.textContent).not.toContain('issue_test_1');
    expect(within(issueRow as HTMLElement).getByText(/acct_opaque_1/)).toBeTruthy();

    cleanup();
    await renderIssueDetail();
    await screen.findByTestId('issue-identity');
    expect(screen.getByTestId('issue-identity').textContent).not.toContain('acct_opaque_1');
    expect(screen.getByTestId('issue-identity').textContent).not.toContain('issue_test_1');
    expect(
      screen.getByTestId('issue-samples').querySelector('.mon-sample > .mon-meta')?.textContent,
    ).not.toContain('sample_opaque_1');
    expect(
      screen.getByTestId('issue-activity').querySelector('.mon-tl-item > .mon-meta')?.textContent,
    ).not.toContain('event_opaque_1');
    expect(
      screen.getByTestId('issue-activity').querySelector('.mon-note-head > .mon-meta')?.textContent,
    ).not.toContain('note_opaque_1');
    expect(screen.getByTestId('issue-technical-details').textContent).toContain('issue_test_1');
    expect(within(screen.getByTestId('issue-samples')).getByText(/sample_opaque_1/)).toBeTruthy();
    expect(within(screen.getByTestId('issue-activity')).getByText(/event_opaque_1/)).toBeTruthy();
  });

  it('renders available C4 lifecycle actions as enabled command controls', async () => {
    await renderIssueDetail();
    await screen.findByTestId('issue-lifecycle-actions');
    for (const name of ['标记处理中', '解决', '永久忽略', '重新打开']) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false);
    }
  });

  it('renders C5 endpoint selection as a semantic keyboard-operable button', async () => {
    await router.push('/organizations/org_test_1/projects/prj_test_1/requests');
    await router.isReady();
    render(ProjectRequestsView, { global: { plugins: [pinia, router] } });
    const endpoint = await screen.findByRole('button', { name: /GET.*\/api\/items/ });
    expect(endpoint.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(endpoint);
    expect(endpoint.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('已选接口')).toBeTruthy();
  });
});

function issueListResponse(options: {
  readonly nextCursor?: string;
  readonly assigneeAccountId?: string;
}) {
  return {
    data: {
      issues: {
        status: 'available',
        items: [
          {
            issueId: 'issue_test_1',
            title: 'TypeError: Cannot read properties of undefined',
            status: 'open',
            occurrenceCount: 1,
            sampleCount: 1,
            firstSeenAt: '2026-08-10T00:00:00.000Z',
            lastSeenAt: '2026-08-10T01:00:00.000Z',
            version: 1,
            ...(options.assigneeAccountId === undefined
              ? {}
              : { assigneeAccountId: options.assigneeAccountId }),
          },
        ],
        pagination: {
          totalCount: 2,
          totalCountStatus: 'available',
          ...(options.nextCursor === undefined ? {} : { nextCursor: options.nextCursor }),
        },
      },
      filters: { status: 'available' },
      summary: { status: 'available' },
      environments: { status: 'unavailable', reason: 'unavailable' },
      releases: { status: 'unavailable', reason: 'unavailable' },
    },
    meta: { requestId: 'req_test_issues', readAt: '2026-08-10T01:00:00.000Z', normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function issueDetailResponse() {
  return {
    data: {
      issue: {
        status: 'available',
        data: {
          issueId: 'issue_test_1',
          title: 'TypeError',
          category: 'runtime',
          fingerprintVersion: 1,
          occurrenceCount: 1,
          sampleCount: 1,
          firstSeenAt: '2026-08-10T00:00:00.000Z',
          lastSeenAt: '2026-08-10T01:00:00.000Z',
          status: 'open',
          assigneeAccountId: 'acct_opaque_1',
          mergedIntoIssueId: 'issue_opaque_2',
          version: 1,
        },
      },
      samples: {
        status: 'available',
        items: [
          {
            sampleId: 'sample_opaque_1',
            occurredAt: '2026-08-10T01:00:00.000Z',
            sampleKind: 'error',
            sampleBody: { message: 'x' },
          },
        ],
      },
      activity: {
        status: 'available',
        activities: [
          {
            activityType: 'event_opaque_1',
            createdAt: '2026-08-10T01:00:00.000Z',
            actorAccountId: 'acct_opaque_1',
            details: {},
          },
        ],
        notes: [
          {
            noteId: 'note_opaque_1',
            authorAccountId: 'acct_opaque_1',
            createdAt: '2026-08-10T01:00:00.000Z',
            content: 'note',
          },
        ],
      },
    },
    meta: { requestId: 'req_test_issue', readAt: '2026-08-10T01:00:00.000Z', normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}
