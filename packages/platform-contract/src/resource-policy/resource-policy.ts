import { arr, bool, enum_, num, obj, optional, str } from '../common/schema.js';
import { AccountId, OrganizationId, ProjectId } from '../common/identifiers.js';
import { paginationMeta } from '../common/pagination.js';
import { utcTimestamp } from '../common/time.js';
import { queryResponse } from '../common/query.js';

export const OPERATION_ID_POLICY_TARGET_SEARCH = 'policyTargetSearch' as const;
export const OPERATION_ID_POLICY_GET_DEFAULT = 'policyGetDefault' as const;
export const OPERATION_ID_POLICY_GET_ORGANIZATION = 'policyGetOrganizationEffective' as const;
export const OPERATION_ID_POLICY_GET_PROJECT = 'policyGetProjectEffective' as const;
export const OPERATION_ID_POLICY_SET_DEFAULT = 'policySetDefault' as const;
export const OPERATION_ID_POLICY_SET_ORGANIZATION = 'policySetOrganization' as const;
export const OPERATION_ID_POLICY_RESET_ORGANIZATION = 'policyResetOrganization' as const;
export const OPERATION_ID_POLICY_SET_PROJECT_LIMIT = 'policySetProjectLimit' as const;
export const OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT = 'policyClearProjectLimit' as const;

/** PRD §15.8 five resource-policy fields shared by the platform default and organization overrides. */
const policyFields = {
  defaultPeriodQuota: num(1),
  warningRatio: num(1, 100),
  hardLimit: num(1, 100),
  degradationEnabled: bool(),
  highValueRetentionDays: num(1),
} as const;

const policyFieldsDef = obj(policyFields);

/** Project-level override: only the resource limit is configurable at project scope (ADR-035). */
const projectLimitField = { resourceLimit: num(1) } as const;

/**
 * Project effective-policy `configured` projection. `resourceLimit` is OPTIONAL:
 * a project with no limit row has no explicit project configuration, so
 * `configured` is an empty object and `effective` omits `resourceLimit` (the
 * ADR-035 model has no inherited project resourceLimit to report).
 */
const projectLimitFieldDef = obj({ resourceLimit: optional(num(1)) });

/** First version has no data-plane consumer, so propagation is always `unknown` (never claims生效). */
const propagation = obj({
  status: enum_(['unknown']),
  reason: str(1, 128),
});

/**
 * Effective policy projection for org-scope targets (platform default / organization
 * effective): configured/source/effective separated per ADR-035.
 */
const policyProjection = obj({
  configured: policyFieldsDef,
  source: str(1, 40),
  effective: policyFieldsDef,
  version: num(0),
  updatedAt: optional(utcTimestamp),
  updatedBy: optional(AccountId),
  propagation,
});

/**
 * Effective policy projection for a project target: the project's own resource-limit
 * override (`configured`) plus the full computed effective policy that inherits the
 * org/platform five-field policy and overlays `resourceLimit`. `resourceLimit` is
 * optional in both (no limit row → no project-specific limit to report).
 */
const projectPolicyProjection = obj({
  configured: projectLimitFieldDef,
  source: str(1, 40),
  effective: obj({
    ...policyFields,
    resourceLimit: optional(num(1)),
  }),
  version: num(0),
  updatedAt: optional(utcTimestamp),
  updatedBy: optional(AccountId),
  propagation,
});

export const policyTargetSearchQuery = obj({
  q: optional(str(1, 64)),
  limit: optional(num(1, 50)),
});

export const policyTargetSearchResponse = queryResponse(
  obj({
    organizations: arr(obj({ organizationId: OrganizationId, name: str(1, 128) }), 0, 50),
    projects: arr(
      obj({ projectId: ProjectId, organizationId: OrganizationId, name: str(1, 128) }),
      0,
      50,
    ),
    pagination: paginationMeta,
  }),
);

export const policyGetDefaultResponse = queryResponse(obj({ data: policyProjection }));

export const policyGetOrganizationEffectivePathParams = obj({ organizationId: OrganizationId });
export const policyGetOrganizationEffectiveResponse = queryResponse(
  obj({ data: policyProjection }),
);

export const policyGetProjectEffectivePathParams = obj({ projectId: ProjectId });
export const policyGetProjectEffectiveResponse = queryResponse(
  obj({ data: projectPolicyProjection }),
);

export const policySetDefaultBody = obj({
  ...policyFields,
  version: num(0),
  idempotencyKey: str(8, 128),
});

export const policySetDefaultResponse = obj({
  data: obj({ status: enum_(['set']), version: num(0) }),
});

export const policySetOrganizationPathParams = obj({ organizationId: OrganizationId });

export const policySetOrganizationBody = obj({
  ...policyFields,
  version: num(0),
  idempotencyKey: str(8, 128),
});

export const policySetOrganizationResponse = obj({
  data: obj({ status: enum_(['set']), version: num(0) }),
});

export const policyResetOrganizationPathParams = obj({ organizationId: OrganizationId });

export const policyResetOrganizationBody = obj({
  version: num(0),
  confirm: bool(),
  idempotencyKey: str(8, 128),
});

export const policyResetOrganizationResponse = obj({ data: obj({ status: enum_(['reset']) }) });

export const policySetProjectLimitPathParams = obj({ projectId: ProjectId });

export const policySetProjectLimitBody = obj({
  ...projectLimitField,
  version: num(0),
  idempotencyKey: str(8, 128),
});

export const policySetProjectLimitResponse = obj({
  data: obj({ status: enum_(['set']), version: num(0) }),
});

export const policyClearProjectLimitPathParams = obj({ projectId: ProjectId });

export const policyClearProjectLimitBody = obj({
  version: num(0),
  confirm: bool(),
  idempotencyKey: str(8, 128),
});

export const policyClearProjectLimitResponse = obj({ data: obj({ status: enum_(['cleared']) }) });
