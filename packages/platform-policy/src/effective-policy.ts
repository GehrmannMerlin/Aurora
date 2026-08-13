import type {
  OrganizationOverride,
  PlatformDefaultPolicy,
  PlatformPolicyFields,
  PolicySource,
  ProjectLimit,
} from './policy-types.js';

/**
 * @aurora/platform-policy — effective policy pure function (PLT-10b, ADR-035).
 *
 * `computeEffectivePolicy` is a PURE function: it performs no I/O and derives
 * the effective projection from the three tier rows already read by the caller.
 * Inheritance is top-down — platform default → (optional) organization full
 * override → (optional) project `resourceLimit`. The remaining protective
 * fields always come from the most specific row present: the organization
 * override when it exists, otherwise the platform default. A missing platform
 * default yields `null` (the platform has not configured a protective policy;
 * this is NOT a normal empty state).
 */

export interface EffectivePolicyInput {
  readonly defaultPolicy: PlatformDefaultPolicy | null;
  readonly orgOverride: OrganizationOverride | null;
  readonly projectLimit: ProjectLimit | null;
}

/** Target's own configured values (most specific row present + project limit). */
export interface EffectivePolicyConfigured extends PlatformPolicyFields {
  readonly resourceLimit?: number;
}

/** Server-computed effective values. */
export interface EffectivePolicyValues extends PlatformPolicyFields {
  readonly resourceLimit?: number;
}

export interface EffectivePolicyProjection {
  readonly configured: EffectivePolicyConfigured;
  readonly source: PolicySource;
  readonly effective: EffectivePolicyValues;
}

export function computeEffectivePolicy(
  input: EffectivePolicyInput,
): EffectivePolicyProjection | null {
  const { defaultPolicy, orgOverride, projectLimit } = input;
  if (defaultPolicy === null) return null;

  const base: PlatformPolicyFields = orgOverride ?? defaultPolicy;

  const resourceLimitFields =
    projectLimit !== null ? { resourceLimit: projectLimit.resourceLimit } : {};

  const configured: EffectivePolicyConfigured = {
    defaultPeriodQuota: base.defaultPeriodQuota,
    warningRatio: base.warningRatio,
    hardLimit: base.hardLimit,
    degradationEnabled: base.degradationEnabled,
    highValueRetentionDays: base.highValueRetentionDays,
    ...resourceLimitFields,
  };
  const effective: EffectivePolicyValues = {
    defaultPeriodQuota: base.defaultPeriodQuota,
    warningRatio: base.warningRatio,
    hardLimit: base.hardLimit,
    degradationEnabled: base.degradationEnabled,
    highValueRetentionDays: base.highValueRetentionDays,
    ...resourceLimitFields,
  };

  return {
    configured,
    source: orgOverride?.policySource ?? defaultPolicy.policySource,
    effective,
  };
}
