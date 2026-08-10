import { arr, enum_, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { timeRange, utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { sectionResult } from '../common/section.js';
import { routeTarget } from '../common/navigation.js';

export const OPERATION_ID_GET_DATA_STATUS = 'diagnosticsGetDataStatus' as const;

export const diagnosticsGetDataStatusPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const diagnosticsGetDataStatusQuery = obj({
  // Optional RFC 3339 UTC window; the server applies the default last-24h window.
  timeRange: optional(timeRange),
});

// DAT-20 spec §5.3: safe diagnosis projection. Every section is a sectionResult so a missing or
// unavailable data source is honestly expressed (empty/unavailable) rather than forged as zero.
// `accepted` (received_at present) is deliberately distinct from `processed` (state='processed').

const diagnosisSummary = obj({
  status: enum_(['receiving', 'processing', 'blocked', 'not_receiving', 'unknown']),
  primaryCause: optional(
    enum_(['credential_inactive', 'no_credential', 'no_received_events', 'processing_backlog']),
  ),
  asOf: utcTimestamp,
});

const stageFact = obj({
  count: num(0),
  latestAt: optional(utcTimestamp),
});

const stageFacts = obj({
  received: stageFact,
  processing: stageFact,
  processed: stageFact,
  // dead_lettered rows additionally expose the stable last_error_code written back by the Worker.
  deadLetter: obj({
    count: num(0),
    latestAt: optional(utcTimestamp),
    lastErrorCode: optional(str(1, 64)),
  }),
});

const recentEvidence = obj({
  latestReceivedAt: optional(utcTimestamp),
  receivedCount: num(0),
  latestProcessedAt: optional(utcTimestamp),
  processedCount: num(0),
  // event_inbox has no environment column: environment evidence is deferred and always unavailable.
  environmentBreakdown: sectionResult(obj({})),
});

// Rejected batches are not persisted (the ingestion API returns 401/403/400 synchronously), so the
// rejection data variant never appears; the section stays sectionResult and reports unavailable.
const rejectionEvidence = obj({});

const credentialSafeStatus = obj({
  activeCount: num(0),
  disabledCount: num(0),
  revokedCount: num(0),
  latestCreatedAt: optional(utcTimestamp),
});

const queryableEvidence = obj({
  errorOccurrences: num(0),
  requestMetricBuckets: num(0),
  performanceMetricBuckets: num(0),
  latestProcessedAt: optional(utcTimestamp),
});

export const diagnosticsGetDataStatusResponse = queryResponse(
  obj({
    summary: sectionResult(diagnosisSummary),
    stages: sectionResult(stageFacts),
    recent: sectionResult(recentEvidence),
    rejection: sectionResult(rejectionEvidence),
    credential: sectionResult(credentialSafeStatus),
    queryable: sectionResult(queryableEvidence),
    actionTargets: arr(routeTarget, 0, 8),
  }),
);
