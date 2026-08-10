import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_UPDATE_ISSUE_STATE,
  OPERATION_ID_UPDATE_ISSUE_ASSIGNEE,
  OPERATION_ID_UPDATE_ISSUE_PRIORITY,
  OPERATION_ID_CREATE_ISSUE_NOTE,
  OPERATION_ID_DELETE_ISSUE_NOTE,
  OPERATION_ID_MERGE_ISSUES,
  OPERATION_ID_BATCH_UPDATE_ISSUES,
  issuesUpdateStateBody,
  issuesUpdateStatePathParams,
  issuesBatchUpdateBody,
} from '../../src/index.js';

const ORG = 'a'.repeat(36);
const PROJECT = 'b'.repeat(36);
const ISSUE = '101';

describe('issue lifecycle Command contracts', () => {
  it('pins the seven stable operation ids', () => {
    expect(OPERATION_ID_UPDATE_ISSUE_STATE).toBe('issuesUpdateState');
    expect(OPERATION_ID_UPDATE_ISSUE_ASSIGNEE).toBe('issuesUpdateAssignee');
    expect(OPERATION_ID_UPDATE_ISSUE_PRIORITY).toBe('issuesUpdatePriority');
    expect(OPERATION_ID_CREATE_ISSUE_NOTE).toBe('issuesCreateNote');
    expect(OPERATION_ID_DELETE_ISSUE_NOTE).toBe('issuesDeleteNote');
    expect(OPERATION_ID_MERGE_ISSUES).toBe('issuesMerge');
    expect(OPERATION_ID_BATCH_UPDATE_ISSUES).toBe('issuesBatchUpdate');
  });

  it('requires organizationId/projectId/issueId path params', () => {
    const schema = issuesUpdateStatePathParams.zod;
    expect(schema.safeParse({ organizationId: ORG, projectId: PROJECT, issueId: ISSUE }).success).toBe(
      true,
    );
    expect(schema.safeParse({ organizationId: ORG, projectId: PROJECT }).success).toBe(false);
  });

  it('validates the update-state body (status + version + idempotencyKey)', () => {
    const schema = issuesUpdateStateBody.zod;
    expect(
      schema.safeParse({
        status: 'in_progress',
        version: 3,
        idempotencyKey: 'k'.repeat(12),
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ status: 'in_progress', version: 3 }).success).toBe(false);
  });

  it('validates the batch body items array (1..100)', () => {
    const schema = issuesBatchUpdateBody.zod;
    expect(
      schema.safeParse({
        items: [
          { issueId: '1', action: 'status', target: 'in_progress', version: 1 },
          { issueId: '2', action: 'priority', target: 'high', version: 1 },
        ],
        idempotencyKey: 'k'.repeat(12),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        items: [
          { issueId: '101', action: 'status', target: 'in_progress', version: 1 },
          { issueId: '102', action: 'priority', target: 'high', version: 1 },
        ],
        idempotencyKey: 'k'.repeat(12),
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ items: [], idempotencyKey: 'k'.repeat(12) }).success).toBe(false);
    expect(
      schema.safeParse({
        items: [{ issueId: '', action: 'status', target: 'in_progress', version: 1 }],
        idempotencyKey: 'k'.repeat(12),
      }).success,
    ).toBe(false);
  });
});
