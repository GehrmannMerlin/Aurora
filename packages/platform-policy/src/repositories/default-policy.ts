import type { Pool, PoolClient } from 'pg';
import {
  PlatformPolicyError,
  isPostgresCheckViolation,
  toStableError,
} from '../errors.js';
import type { PlatformDefaultPolicy, PlatformPolicyFields, StoredPolicySource } from '../policy-types.js';

/**
 * @aurora/platform-policy — platform default policy repository (PLT-10b,
 * ADR-035). `platform_resource_policies` is intended to hold at most ONE row
 * (the platform default); the single-row invariant is enforced by this
 * repository layer, not by a schema constraint. Each write bumps `version`
 * (optimistic concurrency). The controlled bootstrap guarantees a default row
 * exists so `policyGetDefault` always has a value.
 */

export type SetPlatformDefaultPolicyResult =
  | { readonly status: 'set'; readonly version: number }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'temporarily_unavailable' };

export type BootstrapPlatformDefaultResult =
  | { readonly status: 'created' }
  | { readonly status: 'already_exists' };

export interface SetPlatformDefaultPolicyInput extends PlatformPolicyFields {
  readonly expectedVersion: number;
  readonly actorAccountId: string;
}

/**
 * ADR-035 decision 6 suggested defaults (product confirmation point, approved):
 * 1M events/month, warning 80%, hard limit 100%, degradation on, retention 90 days.
 */
export const SUGGESTED_PLATFORM_DEFAULTS: Readonly<Required<PlatformPolicyFields>> = {
  defaultPeriodQuota: 1_000_000,
  warningRatio: 80,
  hardLimit: 100,
  degradationEnabled: true,
  highValueRetentionDays: 90,
} as const;

interface PlatformResourcePolicyRow {
  default_period_quota: string;
  warning_ratio: string;
  hard_limit: string;
  degradation_enabled: boolean;
  high_value_retention_days: number;
  policy_source: StoredPolicySource;
  version: number;
  updated_by: string | null;
  updated_at: Date;
}

const DEFAULT_COLUMNS = `
  default_period_quota, warning_ratio, hard_limit, degradation_enabled,
  high_value_retention_days, policy_source, version, updated_by, updated_at
`;

function toPlatformDefaultPolicy(row: PlatformResourcePolicyRow): PlatformDefaultPolicy {
  return {
    defaultPeriodQuota: Number(row.default_period_quota),
    warningRatio: Number(row.warning_ratio),
    hardLimit: Number(row.hard_limit),
    degradationEnabled: row.degradation_enabled,
    highValueRetentionDays: row.high_value_retention_days,
    policySource: row.policy_source,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  };
}

function requireActorAccountId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PlatformPolicyError('invalid_input', 'actor account id is required');
  }
  return trimmed;
}

function requireExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new PlatformPolicyError(
      'invalid_input',
      'expected version must be a non-negative integer',
    );
  }
  return value;
}

function requirePolicyFields(input: PlatformPolicyFields): Required<PlatformPolicyFields> {
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

/** Read the current platform default row, or `null` when none is configured. */
export async function getPlatformDefaultPolicy(
  pool: Pool | PoolClient,
): Promise<PlatformDefaultPolicy | null> {
  try {
    const result = await pool.query<PlatformResourcePolicyRow>(
      `SELECT ${DEFAULT_COLUMNS}
       FROM platform_resource_policies
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    );
    const row = result.rows[0];
    return row === undefined ? null : toPlatformDefaultPolicy(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Controlled bootstrap: when no platform default row exists, INSERT the
 * ADR-035 suggested defaults with `policy_source = 'system_default'`. Atomic
 * and idempotent (`INSERT ... SELECT ... WHERE NOT EXISTS`). Guarantees the
 * platform default always has a value for `policyGetDefault`.
 */
export async function bootstrapPlatformDefaultIfAbsent(
  pool: Pool | PoolClient,
  input: { readonly actorAccountId: string },
): Promise<BootstrapPlatformDefaultResult> {
  try {
    const actorAccountId = requireActorAccountId(input.actorAccountId);
    const inserted = await pool.query<{ version: number }>(
      `INSERT INTO platform_resource_policies
         (default_period_quota, warning_ratio, hard_limit, degradation_enabled, high_value_retention_days, policy_source, updated_by)
       SELECT $1, $2, $3, $4, $5, 'system_default', $6
       WHERE NOT EXISTS (SELECT 1 FROM platform_resource_policies)
       RETURNING version`,
      [
        SUGGESTED_PLATFORM_DEFAULTS.defaultPeriodQuota,
        SUGGESTED_PLATFORM_DEFAULTS.warningRatio,
        SUGGESTED_PLATFORM_DEFAULTS.hardLimit,
        SUGGESTED_PLATFORM_DEFAULTS.degradationEnabled,
        SUGGESTED_PLATFORM_DEFAULTS.highValueRetentionDays,
        actorAccountId,
      ],
    );
    return inserted.rows.length > 0 ? { status: 'created' } : { status: 'already_exists' };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    throw toStableError(error);
  }
}

/**
 * Save the platform default policy. With no row → INSERT version 1. With a
 * row → `UPDATE ... WHERE version = expectedVersion`; 0 affected rows →
 * `version_conflict`. Always stores `policy_source = 'platform_admin'` (the
 * admin overrode the system default). A DB-enforced ratio CHECK violation is
 * surfaced as `invalid_input / invalid_ratio_order`; any other DB failure is
 * `temporarily_unavailable` (details never leaked).
 */
export async function setPlatformDefaultPolicy(
  pool: Pool | PoolClient,
  input: SetPlatformDefaultPolicyInput,
): Promise<SetPlatformDefaultPolicyResult> {
  try {
    const fields = requirePolicyFields(input);
    const actorAccountId = requireActorAccountId(input.actorAccountId);
    const expectedVersion = requireExpectedVersion(input.expectedVersion);

    const existing = await pool.query<{ id: string; version: number }>(
      'SELECT id, version FROM platform_resource_policies ORDER BY created_at ASC, id ASC LIMIT 1',
    );
    const current = existing.rows[0];

    if (current === undefined) {
      const inserted = await pool.query<{ version: number }>(
        `INSERT INTO platform_resource_policies
           (default_period_quota, warning_ratio, hard_limit, degradation_enabled, high_value_retention_days, policy_source, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'platform_admin', $6)
         RETURNING version`,
        [
          fields.defaultPeriodQuota,
          fields.warningRatio,
          fields.hardLimit,
          fields.degradationEnabled,
          fields.highValueRetentionDays,
          actorAccountId,
        ],
      );
      const row = inserted.rows[0];
      return { status: 'set', version: row?.version ?? 1 };
    }

    if (current.version !== expectedVersion) return { status: 'version_conflict' };

    const updated = await pool.query<{ version: number }>(
      `UPDATE platform_resource_policies
       SET default_period_quota = $1, warning_ratio = $2, hard_limit = $3,
           degradation_enabled = $4, high_value_retention_days = $5,
           policy_source = 'platform_admin', updated_by = $6, updated_at = now(),
           version = version + 1
       WHERE id = $7 AND version = $8
       RETURNING version`,
      [
        fields.defaultPeriodQuota,
        fields.warningRatio,
        fields.hardLimit,
        fields.degradationEnabled,
        fields.highValueRetentionDays,
        actorAccountId,
        current.id,
        expectedVersion,
      ],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) return { status: 'version_conflict' };
    return { status: 'set', version: updatedRow.version };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    if (isPostgresCheckViolation(error)) {
      throw new PlatformPolicyError('invalid_input', 'invalid_ratio_order');
    }
    return { status: 'temporarily_unavailable' };
  }
}
