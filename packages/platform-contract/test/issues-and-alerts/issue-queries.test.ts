import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_GET_ISSUE_DETAIL,
  OPERATION_ID_LIST_ISSUES,
  issuesGetIssueDetailPathParams,
  issuesListIssuesPathParams,
  issuesListIssuesQuery,
} from '../../src/index.js';

const ORG = 'a'.repeat(36);
const PROJECT = 'b'.repeat(36);

describe('issue Query contracts', () => {
  it('pins the two stable operation ids', () => {
    expect(OPERATION_ID_LIST_ISSUES).toBe('issuesListIssues');
    expect(OPERATION_ID_GET_ISSUE_DETAIL).toBe('issuesGetIssueDetail');
  });

  it('validates the list query (timeRange required, filters optional)', () => {
    const schema = issuesListIssuesQuery.zod;
    expect(
      schema.safeParse({
        timeRange: { start: '2026-08-10T00:00:00.000Z', end: '2026-08-10T01:00:00.000Z' },
        status: 'open',
        limit: 25,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ status: 'open' }).success).toBe(false);
  });

  it('validates the path params', () => {
    const listSchema = issuesListIssuesPathParams.zod;
    expect(listSchema.safeParse({ organizationId: ORG, projectId: PROJECT }).success).toBe(true);
    const detailSchema = issuesGetIssueDetailPathParams.zod;
    expect(detailSchema.safeParse({ organizationId: ORG, projectId: PROJECT, issueId: '1' }).success).toBe(true);
    expect(detailSchema.safeParse({ organizationId: ORG, projectId: PROJECT }).success).toBe(false);
  });
});
