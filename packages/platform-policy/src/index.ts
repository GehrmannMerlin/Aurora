/**
 * @aurora/platform-policy — Aurora D2 platform resource policy data layer
 * (PLT-10b, ADR-035).
 *
 * Task 1 scaffold: stable error surface and executable migrations for the
 * three-tier minimal protective resource policy storage — platform default
 * (single row), per-organization full override, per-project optional resource
 * limit — with per-tier optimistic versioning. No override row means inherit;
 * effective values are computed server-side (Task 2). Repository and
 * effective-policy capabilities land in later tasks.
 */
export const PLATFORM_POLICY_PACKAGE = '@aurora/platform-policy' as const;

export const PLATFORM_POLICY_VERSION = '0.0.0' as const;

export { PlatformPolicyError, type PlatformPolicyErrorKind } from './errors.js';
