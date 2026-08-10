import { describe, expect, it } from 'vitest';
import {
  applyCommandResult,
  issuePriorityLabel,
  issueStatusLabel,
} from '../../src/monitoring/issue-workspace.js';
import type { IssueCommandResult } from '../../src/monitoring/commands.js';

describe('issue status/priority labels', () => {
  it('maps every frozen status and priority to a Chinese label', () => {
    expect(issueStatusLabel('open')).toBe('待处理');
    expect(issueStatusLabel('in_progress')).toBe('处理中');
    expect(issueStatusLabel('resolved')).toBe('已解决');
    expect(issueStatusLabel('ignored')).toBe('已忽略');
    expect(issueStatusLabel('reopened')).toBe('重新打开');
    expect(issuePriorityLabel('urgent')).toBe('紧急');
    expect(issuePriorityLabel('high')).toBe('高');
    expect(issuePriorityLabel('medium')).toBe('中');
    expect(issuePriorityLabel('low')).toBe('低');
  });

  it('falls back to the raw value for an unknown status and shows unset for missing priority', () => {
    expect(issueStatusLabel('weird')).toBe('weird');
    expect(issuePriorityLabel(undefined)).toBe('未设置');
  });
});

describe('applyCommandResult', () => {
  it('folds the server-returned authority values into the detail state', () => {
    const result: IssueCommandResult = {
      status: 'in_progress',
      issueId: 'issue_1',
      version: 2,
      activity: { type: 'status_changed', createdAt: '2026-08-10T00:00:00.000Z' },
    };
    const next = applyCommandResult(
      { status: 'open', version: 1, assigneeAccountId: 'acc_1', priority: 'high' },
      result,
    );
    expect(next.status).toBe('in_progress');
    expect(next.version).toBe(2);
    // Server command result does not carry assignee/priority, so existing values are preserved.
    expect(next.assigneeAccountId).toBe('acc_1');
    expect(next.priority).toBe('high');
  });
});
