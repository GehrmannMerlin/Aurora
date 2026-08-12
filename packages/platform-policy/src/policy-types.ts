/**
 * @aurora/platform-policy — shared policy types (PLT-10b, ADR-035).
 *
 * The three-tier minimal protective resource policy stores five PRD §15.8
 * config fields at the platform default and per-organization override tiers,
 * plus an optional per-project `resourceLimit`. "No row" means inherit; the
 * effective values are computed server-side (never cached) by the pure
 * `computeEffectivePolicy` function in `effective-policy.ts`.
 */

/** The five PRD §15.8 protective config fields carried by a policy row. */
export interface PlatformPolicyFields {
  /** Default organization periodic quota in events. */
  readonly defaultPeriodQuota: number;
  /** Warning ratio (0-100); DB-enforced `0 < warningRatio < hardLimit`. */
  readonly warningRatio: number;
  /** Hard limit ratio (0-100); DB-enforced `warningRatio < hardLimit <= 100`. */
  readonly hardLimit: number;
  /** Degradation switch. */
  readonly degradationEnabled: boolean;
  /** Minimum high-value event retention in days. */
  readonly highValueRetentionDays: number;
}

/** `policy_source` values a policy row can actually store (DB CHECK). */
export type StoredPolicySource = 'system_default' | 'platform_admin';

/**
 * Effective-policy source projection. A row's own stored source is always
 * `StoredPolicySource`; the two `inherited_from_*` values describe a target
 * whose effective configuration is inherited from an ancestor tier and are
 * produced at the query/handler layer (Task 4/5), not stored.
 */
export type PolicySource =
  | StoredPolicySource
  | 'inherited_from_organization'
  | 'inherited_from_platform';

/** Platform default policy row projection. */
export interface PlatformDefaultPolicy extends PlatformPolicyFields {
  readonly policySource: StoredPolicySource;
  /** Optimistic concurrency guard. */
  readonly version: number;
  /** ISO-8601 UTC timestamp of the last save. */
  readonly updatedAt: string;
  /** Platform admin account id of the last save. */
  readonly updatedBy?: string;
}

/** Per-organization full override row projection. */
export interface OrganizationOverride extends PlatformPolicyFields {
  readonly organizationId: string;
  readonly policySource: StoredPolicySource;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Optional per-project resource limit row projection. */
export interface ProjectLimit {
  readonly projectId: string;
  readonly resourceLimit: number;
  readonly policySource: StoredPolicySource;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}
