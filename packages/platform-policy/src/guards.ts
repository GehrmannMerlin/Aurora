import { PlatformPolicyError } from './errors.js';
import type { PlatformPolicyFields } from './policy-types.js';

/**
 * @aurora/platform-policy — shared synchronous input guards (PLT-10b, ADR-035).
 *
 * The three policy repositories each validate the actor account id, the
 * optimistic expected version and the PRD §15.8 policy fields before touching
 * the database. These helpers are the single definition of those validations so
 * the repositories cannot drift (e.g. one path accepting a blank actor id or a
 * non-integer version). They throw the stable `invalid_input` error, which the
 * repositories rethrow (or the handler maps to a closed 422 field_validation).
 *
 * NOTE: these guards are PURE field validation. The DB-level "actor exists"
 * check performed by the org/project set paths lives in the repositories
 * (a missing actor is deliberately surfaced as `temporarily_unavailable` so no
 * account-id existence is leaked); the platform default path does not perform
 * that check, and the shared guards do not add it.
 */

export function requireActorAccountId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PlatformPolicyError('invalid_input', 'actor account id is required');
  }
  return trimmed;
}

export function requireExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new PlatformPolicyError(
      'invalid_input',
      'expected version must be a non-negative integer',
    );
  }
  return value;
}

export function requirePolicyFields(input: PlatformPolicyFields): Required<PlatformPolicyFields> {
  for (const [label, value] of Object.entries({
    defaultPeriodQuota: input.defaultPeriodQuota,
    warningRatio: input.warningRatio,
    hardLimit: input.hardLimit,
    highValueRetentionDays: input.highValueRetentionDays,
  })) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PlatformPolicyError('invalid_input', `${label} must be a finite number`);
    }
  }
  if (typeof input.degradationEnabled !== 'boolean') {
    throw new PlatformPolicyError('invalid_input', 'degradationEnabled must be a boolean');
  }
  return {
    defaultPeriodQuota: input.defaultPeriodQuota,
    warningRatio: input.warningRatio,
    hardLimit: input.hardLimit,
    degradationEnabled: input.degradationEnabled,
    highValueRetentionDays: input.highValueRetentionDays,
  };
}

export function requireResourceLimit(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PlatformPolicyError('invalid_input', 'resource limit must be a finite number');
  }
  return value;
}
