import { arr, bool, enum_, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';

/**
 * C14 client-key (ingestion upload credential) contract (UX/UI §7.29 / PRD §13.1
 * / ADR-013/014). These are the keys that actually authenticate SDK uploads
 * (`ingestion_client_credentials`, verified by the ingestion-api authorizer).
 * The full client key is returned exactly once on create/rotate; every later
 * read is metadata-only. The management HTTP API is what this contract exposes.
 */

export const OPERATION_ID_CREDENTIALS_LIST = 'credentialsListClientKeys' as const;
export const OPERATION_ID_CREDENTIALS_CREATE = 'credentialsCreateClientKey' as const;
export const OPERATION_ID_CREDENTIALS_DISABLE = 'credentialsDisableClientKey' as const;
export const OPERATION_ID_CREDENTIALS_ENABLE = 'credentialsEnableClientKey' as const;
export const OPERATION_ID_CREDENTIALS_REVOKE = 'credentialsRevokeClientKey' as const;

export const CLIENT_KEY_STATUS_VALUES = ['active', 'disabled', 'revoked'] as const;

const clientKeyMetadata = obj({
  credentialId: str(1, 64),
  keyId: str(8, 128),
  status: enum_(CLIENT_KEY_STATUS_VALUES),
  allowNonBrowser: bool(),
  expiresAt: optional(utcTimestamp),
  origins: arr(str(1, 256), 0, 50),
  environments: arr(str(1, 256), 0, 50),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
});

export const credentialsListClientKeysPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const credentialsListClientKeysResponse = queryResponse(
  sectionResult(obj({ items: arr(clientKeyMetadata, 0, 200) })),
);

export const credentialsCreateClientKeyPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const credentialsCreateClientKeyBody = obj({
  origins: arr(str(1, 256), 0, 50),
  environments: arr(str(1, 256), 0, 50),
  allowNonBrowser: bool(),
  expiresAt: optional(utcTimestamp),
  idempotencyKey,
});

export const credentialsCreateClientKeyResponse = obj({
  data: obj({
    status: enum_(['created']),
    credentialId: str(1, 64),
    keyId: str(8, 128),
    /** One-time delivery: present only in the first successful response. */
    clientKey: str(20, 256),
    expiresAt: optional(utcTimestamp),
    origins: arr(str(1, 256), 0, 50),
    environments: arr(str(1, 256), 0, 50),
  }),
});

const clientKeyMutationPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  keyId: str(8, 128),
});

export const credentialsDisableClientKeyPathParams = clientKeyMutationPathParams;
export const credentialsEnableClientKeyPathParams = clientKeyMutationPathParams;
export const credentialsRevokeClientKeyPathParams = clientKeyMutationPathParams;

export const credentialsDisableClientKeyBody = obj({ idempotencyKey });
export const credentialsEnableClientKeyBody = obj({ idempotencyKey });
export const credentialsRevokeClientKeyBody = obj({ idempotencyKey });

export const credentialsDisableClientKeyResponse = obj({
  data: obj({ status: enum_(['disabled']), credentialId: str(1, 64), keyId: str(8, 128) }),
});
export const credentialsEnableClientKeyResponse = obj({
  data: obj({ status: enum_(['enabled']), credentialId: str(1, 64), keyId: str(8, 128) }),
});
export const credentialsRevokeClientKeyResponse = obj({
  data: obj({ status: enum_(['revoked']), credentialId: str(1, 64), keyId: str(8, 128) }),
});
