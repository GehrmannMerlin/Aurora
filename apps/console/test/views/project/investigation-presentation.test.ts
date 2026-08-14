import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
