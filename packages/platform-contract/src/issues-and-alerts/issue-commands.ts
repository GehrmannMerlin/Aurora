import { arr, bool, num, obj, optional, str } from '../common/schema.js';
import { IssueId, OrganizationId, ProjectId } from '../common/identifiers.js';

/** NoteId is a server-opaque stable string (bigint id rendered as text). */
export const NoteId = str(1, 64);

export const OPERATION_ID_UPDATE_ISSUE_STATE = 'issuesUpdateState' as const;
export const OPERATION_ID_UPDATE_ISSUE_ASSIGNEE = 'issuesUpdateAssignee' as const;
export const OPERATION_ID_UPDATE_ISSUE_PRIORITY = 'issuesUpdatePriority' as const;
export const OPERATION_ID_CREATE_ISSUE_NOTE = 'issuesCreateNote' as const;
export const OPERATION_ID_DELETE_ISSUE_NOTE = 'issuesDeleteNote' as const;
export const OPERATION_ID_MERGE_ISSUES = 'issuesMerge' as const;
export const OPERATION_ID_BATCH_UPDATE_ISSUES = 'issuesBatchUpdate' as const;

const issuePath = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  issueId: IssueId,
});

const idempotency = { idempotencyKey: str(8, 128) };

/** Common Command success shape: authoritative issue id/version/status + safe activity summary. */
const commandSuccess = obj({
  status: str(1, 16),
  issueId: IssueId,
  version: num(1),
  activity: obj({
    type: str(1, 32),
    createdAt: str(1, 40),
    actorAccountId: optional(str(1, 64)),
  }),
});

export const issuesUpdateStatePathParams = issuePath;
export const issuesUpdateStateBody = obj({
  status: str(1, 16),
  version: num(1),
  resolution: optional(
    obj({
      reason: str(1, 16),
      version: optional(str(1, 64)),
      resolvedAtIso: optional(str(1, 40)),
    }),
  ),
  ignoredUntilIso: optional(str(1, 40)),
  ...idempotency,
});
export const issuesUpdateStateResponse = obj({ data: commandSuccess });

export const issuesUpdateAssigneePathParams = issuePath;
export const issuesUpdateAssigneeBody = obj({
  assigneeAccountId: optional(str(1, 64)),
  version: num(1),
  ...idempotency,
});
export const issuesUpdateAssigneeResponse = obj({ data: commandSuccess });

export const issuesUpdatePriorityPathParams = issuePath;
export const issuesUpdatePriorityBody = obj({
  priority: optional(str(1, 16)),
  version: num(1),
  ...idempotency,
});
export const issuesUpdatePriorityResponse = obj({ data: commandSuccess });

export const issuesCreateNotePathParams = issuePath;
export const issuesCreateNoteBody = obj({
  content: str(1, 4096),
  ...idempotency,
});
export const issuesCreateNoteResponse = obj({
  data: obj({ status: str(1, 16), issueId: IssueId, noteId: NoteId }),
});

export const issuesDeleteNotePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  issueId: IssueId,
  noteId: NoteId,
});
export const issuesDeleteNoteBody = obj(idempotency);
export const issuesDeleteNoteResponse = obj({
  data: obj({ status: str(1, 16), issueId: IssueId, noteId: NoteId }),
});

export const issuesMergePathParams = issuePath;
export const issuesMergeBody = obj({
  primaryIssueId: IssueId,
  version: num(1),
  ...idempotency,
});
export const issuesMergeResponse = obj({
  data: obj({
    status: str(1, 16),
    issueId: IssueId,
    mergedIntoIssueId: IssueId,
  }),
});

export const issuesBatchUpdatePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

const issueBatchItem = obj({
  issueId: IssueId,
  action: str(1, 16),
  target: optional(str(1, 64)),
  version: num(1),
});

export const issuesBatchUpdateBody = obj({
  items: arr(issueBatchItem, 1, 100),
  ...idempotency,
});

const issueBatchItemResult = obj({
  issueId: IssueId,
  ok: bool(),
  code: optional(str(1, 32)),
});

export const issuesBatchUpdateResponse = obj({
  data: obj({
    status: str(1, 16),
    succeeded: num(0),
    failed: num(0),
    items: arr(issueBatchItemResult, 0, 100),
  }),
});
