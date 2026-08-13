import { arr, bool, num, obj, optional, rec, str } from '../common/schema.js';
import { AccountId, AuditEventId } from '../common/identifiers.js';
import { paginationMeta } from '../common/pagination.js';
import { utcTimestamp } from '../common/time.js';
import { queryResponse } from '../common/query.js';

export const OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY = 'platformAdminGetCapability' as const;
export const OPERATION_ID_PLATFORM_ADMIN_LIST = 'platformAdminList' as const;
export const OPERATION_ID_PLATFORM_ADMIN_GRANT = 'platformAdminGrant' as const;
export const OPERATION_ID_PLATFORM_ADMIN_REVOKE = 'platformAdminRevoke' as const;
export const OPERATION_ID_PLATFORM_AUDIT_LIST = 'platformAuditListEvents' as const;

const adminSummary = obj({
  accountId: AccountId,
  grantedBy: AccountId,
  grantedAt: utcTimestamp,
});

const adminSection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  items: arr(adminSummary, 0, 100),
  pagination: paginationMeta,
});

/** D2 capability: plain data envelope (no meta/allowedActions/navigationTargets). */
export const platformAdminGetCapabilityResponse = obj({
  data: obj({ hasCapability: bool() }),
});

export const platformAdminListResponse = queryResponse(
  obj({
    admins: adminSection,
  }),
);

export const platformAdminGrantPathParams = obj({
  accountId: AccountId,
});

export const platformAdminGrantBody = obj({
  idempotencyKey: str(8, 128),
});

export const platformAdminGrantResponse = obj({
  data: obj({ status: str(1, 32), accountId: AccountId }),
});

export const platformAdminRevokePathParams = obj({
  accountId: AccountId,
});

export const platformAdminRevokeBody = obj({
  idempotencyKey: str(8, 128),
});

export const platformAdminRevokeResponse = obj({
  data: obj({ status: str(1, 32), accountId: AccountId }),
});

/** Platform-level audit event (independent of B7; complete actor accountId, constrained target). */
const auditEvent = obj({
  eventId: AuditEventId,
  action: str(1, 48),
  actorAccountId: AccountId,
  target: rec(str(1, 4096)),
  result: str(1, 16),
  occurredAt: utcTimestamp,
  requestId: optional(str(1, 64)),
});

const auditSection = obj({
  status: str(1, 16),
  reason: optional(str(1, 128)),
  items: arr(auditEvent, 0, 50),
  pagination: paginationMeta,
});

export const platformAuditListEventsQuery = obj({
  cursor: optional(str(1, 512)),
  limit: optional(num(1, 50)),
});

export const platformAuditListEventsResponse = queryResponse(
  obj({
    events: auditSection,
  }),
);
