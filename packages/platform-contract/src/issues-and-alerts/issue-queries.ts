import { arr, num, obj, optional, rec, str } from '../common/schema.js';
import { IssueId, OrganizationId, ProjectId } from '../common/identifiers.js';
import { timeRange, utcTimestamp } from '../common/time.js';
import { queryResponse } from '../common/query.js';

export const OPERATION_ID_LIST_ISSUES = 'issuesListIssues' as const;
export const OPERATION_ID_GET_ISSUE_DETAIL = 'issuesGetIssueDetail' as const;

export const issuesListIssuesPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const issuesListIssuesQuery = obj({
  timeRange,
  status: optional(str(1, 16)),
  assigneeAccountId: optional(str(1, 64)),
  priority: optional(str(1, 16)),
  cursor: optional(str(1, 512)),
  limit: optional(num(1, 100)),
});

const issueSummary = obj({
  issueId: IssueId,
  title: str(1, 512),
  status: str(1, 16),
  occurrenceCount: num(0),
  sampleCount: num(0),
  firstSeenAt: utcTimestamp,
  lastSeenAt: utcTimestamp,
  assigneeAccountId: optional(str(1, 64)),
  priority: optional(str(1, 16)),
  version: num(1),
});

const issueListData = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  items: arr(issueSummary, 0, 100),
  pagination: obj({
    cursor: optional(str(1, 512)),
    nextCursor: optional(str(1, 512)),
    totalCount: num(0),
    totalCountStatus: str(1, 32),
  }),
});

const section = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
});

export const issuesListIssuesResponse = queryResponse(
  obj({
    issues: issueListData,
    filters: section,
    summary: section,
    environments: section,
    releases: section,
  }),
);

export const issuesGetIssueDetailPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  issueId: IssueId,
});

const issueDetail = obj({
  issueId: IssueId,
  title: str(1, 512),
  category: str(1, 32),
  fingerprintVersion: num(0),
  occurrenceCount: num(0),
  sampleCount: num(0),
  firstSeenAt: utcTimestamp,
  lastSeenAt: utcTimestamp,
  status: str(1, 16),
  assigneeAccountId: optional(str(1, 64)),
  priority: optional(str(1, 16)),
  resolvedReason: optional(str(1, 16)),
  resolvedVersion: optional(str(1, 64)),
  resolvedAt: optional(utcTimestamp),
  ignoredUntil: optional(utcTimestamp),
  mergedIntoIssueId: optional(str(1, 64)),
  version: num(1),
});

const issueDetailSection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  data: optional(issueDetail),
});

/** Flat safe projection of a representative sample body (never raw PII/URLs). */
const sampleProjection = obj({
  sampleId: str(1, 64),
  occurredAt: utcTimestamp,
  sampleKind: str(1, 32),
  sampleBody: rec(str(1, 4096)),
});

const samplesSection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  items: optional(arr(sampleProjection, 0, 100)),
});

const activityEntry = obj({
  activityType: str(1, 32),
  createdAt: utcTimestamp,
  actorAccountId: optional(str(1, 64)),
  details: rec(str(1, 4096)),
});

const noteProjection = obj({
  noteId: str(1, 64),
  authorAccountId: str(1, 64),
  content: optional(str(1, 4096)),
  createdAt: utcTimestamp,
  deletedAt: optional(utcTimestamp),
});

const activitySection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  activities: optional(arr(activityEntry, 0, 200)),
  notes: optional(arr(noteProjection, 0, 100)),
});

export const issuesGetIssueDetailResponse = queryResponse(
  obj({
    issue: issueDetailSection,
    samples: samplesSection,
    activity: activitySection,
  }),
);
