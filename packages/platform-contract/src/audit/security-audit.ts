import { arr, enum_, num, obj, optional, str } from '../common/schema.js';
import { paginationMeta } from '../common/pagination.js';
import { utcTimestamp } from '../common/time.js';
import { AuditEventId, OrganizationId, ProjectId } from '../common/identifiers.js';

export const OPERATION_ID_LIST_SECURITY_AUDIT = 'auditListSecurityAudit' as const;

export const auditListSecurityAuditPathParams = obj({
  organizationId: OrganizationId,
});

export const auditListSecurityAuditQuery = obj({
  cursor: optional(str(1, 64)),
  limit: num(1, 100),
});

// B7 read-only security timeline: redacted summaries only. The actor is masked, the action is a
// stable string, and no password/token/email body is ever projected.
const auditEventSummary = obj({
  eventId: AuditEventId,
  action: str(1, 128),
  occurredAt: utcTimestamp,
  result: enum_(['succeeded', 'failed', 'blocked']),
  actorMasked: str(3, 320),
  targetProjectRef: optional(obj({ projectId: ProjectId })),
});

export const auditListSecurityAuditResponse = obj({
  events: arr(auditEventSummary, 0, 100),
  pagination: paginationMeta,
});
