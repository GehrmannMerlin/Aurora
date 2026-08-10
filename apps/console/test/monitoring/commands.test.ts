import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  createIssueNote,
  deleteIssueNote,
  mergeIssues,
  updateIssueAssignee,
  updateIssuePriority,
  updateIssueState,
  type IssueCommandResult,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

const result: IssueCommandResult = {
  status: 'in_progress',
  issueId: 'issue_1',
  version: 2,
  activity: { type: 'status_changed', createdAt: '2026-08-10T00:00:00.000Z' },
};

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: result });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

function lastInputBody(): Record<string, unknown> {
  const input = lastCall().input;
  return (input?.body ?? {}) as Record<string, unknown>;
}

describe('issue lifecycle Command client', () => {
  it('updateIssueState sends the state command with version + idempotency + csrf', async () => {
    const out = await updateIssueState(
      SCOPE,
      'issue_1',
      { status: 'in_progress', version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(out).toEqual(result);
    const call = lastCall();
    expect(call.operationId).toBe('issuesUpdateState');
    expect(call.scope).toEqual({ type: 'project', id: 'prj_1' });
    expect(call.csrf).toBe(CSRF);
    expect(call.input).toMatchObject({
      pathParams: { organizationId: 'org_1', projectId: 'prj_1', issueId: 'issue_1' },
      body: { status: 'in_progress', version: 1, idempotencyKey: FIXED_KEY },
    });
  });

  it('updateIssueState forwards resolution + ignoredUntil for resolved/ignored', async () => {
    await updateIssueState(
      SCOPE,
      'issue_1',
      {
        status: 'resolved',
        version: 1,
        resolution: { reason: 'by_time', resolvedAtIso: '2026-08-10T00:00:00.000Z' },
      },
      { csrf: CSRF },
    );
    expect(lastInputBody()).toMatchObject({
      status: 'resolved',
      version: 1,
      resolution: { reason: 'by_time', resolvedAtIso: '2026-08-10T00:00:00.000Z' },
    });
  });

  it('updateIssueAssignee sends only provided fields', async () => {
    await updateIssueAssignee(
      SCOPE,
      'issue_1',
      { assigneeAccountId: 'acc_9', version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(lastCall().operationId).toBe('issuesUpdateAssignee');
    expect(lastInputBody()).toMatchObject({
      assigneeAccountId: 'acc_9',
      version: 1,
      idempotencyKey: FIXED_KEY,
    });
  });

  it('updateIssuePriority sends priority or clears it', async () => {
    await updateIssuePriority(
      SCOPE,
      'issue_1',
      { priority: 'high', version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(lastInputBody()).toMatchObject({ priority: 'high', version: 1 });
    await updateIssuePriority(
      SCOPE,
      'issue_1',
      { version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(lastInputBody()).not.toHaveProperty('priority');
  });

  it('createIssueNote sends content + noteId path', async () => {
    mockedExecuteQuery.mockResolvedValue({
      data: { status: 'succeeded', issueId: 'issue_1', noteId: 'note_1' },
    });
    const out = await createIssueNote(
      SCOPE,
      'issue_1',
      { content: 'root cause' },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(out.noteId).toBe('note_1');
    expect(lastCall().operationId).toBe('issuesCreateNote');
    expect(lastInputBody()).toMatchObject({ content: 'root cause', idempotencyKey: FIXED_KEY });
  });

  it('deleteIssueNote sends the noteId path', async () => {
    await deleteIssueNote(SCOPE, 'issue_1', 'note_7', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('issuesDeleteNote');
    expect(lastCall().input).toMatchObject({ pathParams: { noteId: 'note_7' } });
  });

  it('mergeIssues sends the primary issue id + version', async () => {
    mockedExecuteQuery.mockResolvedValue({
      data: { status: 'succeeded', issueId: 'issue_1', mergedIntoIssueId: 'issue_2' },
    });
    const out = await mergeIssues(
      SCOPE,
      'issue_1',
      { primaryIssueId: 'issue_2', version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(out.mergedIntoIssueId).toBe('issue_2');
    expect(lastCall().operationId).toBe('issuesMerge');
    expect(lastInputBody()).toMatchObject({ primaryIssueId: 'issue_2', version: 1 });
  });
});
