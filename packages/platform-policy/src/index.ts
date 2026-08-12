/**
 * @aurora/platform-policy — Aurora D2 platform resource policy data layer
 * (PLT-10b, ADR-035).
 *
 * Minimal three-tier protective resource policy storage — platform default
 * (single row), per-organization full override, per-project optional resource
 * limit — with per-tier optimistic versioning. No override row means inherit;
 * effective values are computed server-side by the pure `computeEffectivePolicy`
 * (never cached). Repository functions are raw SQL over `pg` with the stable
 * `PlatformPolicyError` surface.
 */
export const PLATFORM_POLICY_PACKAGE = '@aurora/platform-policy' as const;

export const PLATFORM_POLICY_VERSION = '0.0.0' as const;

export {
  PlatformPolicyError,
  isPostgresCheckViolation,
  isPostgresUniqueViolation,
  toStableError,
  type PlatformPolicyErrorKind,
} from './errors.js';

export type {
  OrganizationOverride,
  PlatformDefaultPolicy,
  PlatformPolicyFields,
  PolicySource,
  ProjectLimit,
  StoredPolicySource,
} from './policy-types.js';

export {
  computeEffectivePolicy,
  type EffectivePolicyConfigured,
  type EffectivePolicyInput,
  type EffectivePolicyProjection,
  type EffectivePolicyValues,
} from './effective-policy.js';

export {
  SUGGESTED_PLATFORM_DEFAULTS,
  bootstrapPlatformDefaultIfAbsent,
  getPlatformDefaultPolicy,
  setPlatformDefaultPolicy,
  type BootstrapPlatformDefaultResult,
  type SetPlatformDefaultPolicyInput,
  type SetPlatformDefaultPolicyResult,
} from './repositories/default-policy.js';

export {
  getOrganizationOverride,
  resetOrganizationOverride,
  setOrganizationOverride,
  type ResetOrganizationOverrideResult,
  type SetOrganizationOverrideInput,
  type SetOrganizationOverrideResult,
} from './repositories/organization-override.js';

export {
  clearProjectLimit,
  getProjectLimit,
  setProjectLimit,
  type ClearProjectLimitResult,
  type SetProjectLimitInput,
  type SetProjectLimitResult,
} from './repositories/project-limit.js';

export {
  searchPolicyTargets,
  type PolicyTargetOrganization,
  type PolicyTargetProject,
  type PolicyTargetSearchInput,
  type PolicyTargetSearchResult,
} from './repositories/target-search.js';
