import { arr, enum_, num, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId } from '../common/identifiers.js';

export const OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT = 'identityDeleteAccountPreflight' as const;
export const OPERATION_ID_REQUEST_ACCOUNT_DELETION = 'identityRequestAccountDeletion' as const;
export const OPERATION_ID_DELETE_ACCOUNT = 'identityDeleteAccount' as const;
export const OPERATION_ID_CANCEL_ACCOUNT_DELETION = 'identityCancelAccountDeletion' as const;
export const OPERATION_ID_DELETE_ACCOUNT_INTENT_LINK = 'identityDeleteAccountIntentLink' as const;
export const OPERATION_ID_CANCEL_ACCOUNT_DELETION_INTENT_LINK =
  'identityCancelAccountDeletionIntentLink' as const;

const blockingOrganization = obj({
  organizationId: OrganizationId,
  organizationName: str(1, 80),
  organizationKind: enum_(['personal', 'organization']),
});

// A5 preflight projection (spec §5.2/§6.2): ready = no unique-owner blocker; blocked = blocking
// organizations (minimum identifying info only); unavailable = projection undeterminable (fail-closed).
// Only organizations the current account can still see appear in the list.
export const identityDeleteAccountPreflightResponse = obj({
  status: enum_(['ready', 'blocked', 'unavailable']),
  blockingOrganizations: optional(arr(blockingOrganization)),
  requiredLifecycle: obj({
    coolingHours: num(),
    onlineCleanupDays: num(),
    auditRetentionYears: num(),
    backupRetentionDays: num(),
  }),
  serverTime: utcTimestamp,
});

// The one-time deletion confirmation is carried by the HttpOnly intent cookie, never in the body.
export const identityDeleteAccountRequest = obj({
  currentPassword: str(8, 256),
  idempotencyKey,
});

export const identityDeleteAccountResponse = obj({
  status: enum_(['succeeded']),
  accountStatus: enum_(['deletion_cooling']),
  deletionRequestedAt: utcTimestamp,
  deletionCoolingEndsAt: utcTimestamp,
  sessionImpact: enum_(['revoked_all']),
});

// A5 request step (spec §5.2): the session triggers creation of the
// `deletion_request` intent and the confirmation email. Mirrors the PLT-03
// request-reset enumeration-safe shape — the response never reveals intent
// existence or account state beyond the masked recipient.
export const identityRequestAccountDeletionRequest = obj({
  idempotencyKey,
});

export const identityRequestAccountDeletionResponse = obj({
  status: enum_(['succeeded']),
  maskedEmail: str(3, 320),
  resendAvailableAt: optional(utcTimestamp),
});

// The one-time deletion cancellation confirmation is carried by the HttpOnly intent cookie.
export const identityCancelAccountDeletionRequest = obj({
  currentPassword: str(8, 256),
  idempotencyKey,
});

export const identityCancelAccountDeletionResponse = obj({
  status: enum_(['succeeded']),
  accountStatus: enum_(['active']),
  sessionImpact: enum_(['revoked_all']),
});

export const identityDeleteAccountIntentLinkPathParams = obj({
  token: str(1, 256),
});

export const identityCancelAccountDeletionIntentLinkPathParams = obj({
  token: str(1, 256),
});

// Shared intent-link projection (mirrors the PLT-03 intent-link response shape): the transient
// token is cleared from the URL and lives only in the short-lived HttpOnly intent cookie; the raw
// token never enters the body, a redirect URL, or the store.
const intentLinkResponse = obj({
  status: enum_(['valid']),
  csrf: str(1, 256),
  maskedEmail: optional(str(3, 320)),
  intentKind: enum_(['deletion_request', 'deletion_cancel']),
});

export const identityDeleteAccountIntentLinkResponse = intentLinkResponse;
export const identityCancelAccountDeletionIntentLinkResponse = intentLinkResponse;
