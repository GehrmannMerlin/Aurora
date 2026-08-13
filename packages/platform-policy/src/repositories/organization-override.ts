import type { Pool, PoolClient } from 'pg';
import {
  PlatformPolicyError,
  isPostgresCheckViolation,
  toStableError,
} from '../errors.js';
import { requireActorAccountId, requireExpectedVersion, requirePolicyFields } from '../guards.js';
import type { OrganizationOverride, PlatformPolicyFields, StoredPolicySource } from '../policy-types.js';

/**
 * @aurora/platform-policy — organization policy override repository (PLT-10b,
 * ADR-035). One row per organization with a FULL six-field override; no row
 * means the organization inherits the platform default. The override is a
 * complete replacement on save (versioned); "restore platform default" deletes
 * the row. `expectedVersion: 0` means "no override row yet" → INSERT (version 1);
 * `> 0` means UPDATE with optimistic versioning.
 */

export type SetOrganizationOverrideResult =
  | { readonly status: 'set'; readonly version: number }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'organization_not_found' }
  | { readonly status: 'temporarily_unavailable' };

export type ResetOrganizationOverrideResult =
  | { readonly status: 'reset' }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'temporarily_unavailable' };

export interface SetOrganizationOverrideInput extends PlatformPolicyFields {
  readonly organizationId: string;
  readonly expectedVersion: number;
  readonly actorAccountId: string;
}

interface OrganizationOverrideRow {
  organization_id: string;
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

const OVERRIDE_COLUMNS = `
  organization_id, default_period_quota, warning_ratio, hard_limit, degradation_enabled,
  high_value_retention_days, policy_source, version, updated_by, updated_at
`;

function toOrganizationOverride(row: OrganizationOverrideRow): OrganizationOverride {
  return {
    organizationId: row.organization_id,
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

/** Read the organization's full override row, or `null` when it inherits. */
export async function getOrganizationOverride(
  pool: Pool | PoolClient,
  input: { readonly organizationId: string },
): Promise<OrganizationOverride | null> {
  try {
    const result = await pool.query<OrganizationOverrideRow>(
      `SELECT ${OVERRIDE_COLUMNS}
       FROM organization_policy_overrides
       WHERE organization_id = $1`,
      [input.organizationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toOrganizationOverride(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Save the organization's full override. Existence checks first: a missing
 * organization → `organization_not_found`; a missing actor → `temporarily
 * _unavailable` (details never leaked). `expectedVersion: 0` with no row →
 * INSERT (version 1); `> 0` with a row → optimistic UPDATE; a stale version →
 * `version_conflict`. A DB-enforced ratio CHECK violation is surfaced as
 * `invalid_input / invalid_ratio_order`.
 */
export async function setOrganizationOverride(
  pool: Pool | PoolClient,
  input: SetOrganizationOverrideInput,
): Promise<SetOrganizationOverrideResult> {
  try {
    const fields = requirePolicyFields(input);
    const actorAccountId = requireActorAccountId(input.actorAccountId);
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    const organizationId = input.organizationId.trim();

    const organization = await pool.query('SELECT 1 FROM organizations WHERE organization_id = $1', [
      organizationId,
    ]);
    if (organization.rows.length === 0) return { status: 'organization_not_found' };

    const actor = await pool.query('SELECT 1 FROM accounts WHERE account_id = $1', [
      actorAccountId,
    ]);
    if (actor.rows.length === 0) return { status: 'temporarily_unavailable' };

    const existing = await pool.query<{ version: number }>(
      'SELECT version FROM organization_policy_overrides WHERE organization_id = $1',
      [organizationId],
    );
    const current = existing.rows[0];

    if (current === undefined) {
      if (expectedVersion !== 0) return { status: 'version_conflict' };
      const inserted = await pool.query<{ version: number }>(
        `INSERT INTO organization_policy_overrides
           (organization_id, default_period_quota, warning_ratio, hard_limit, degradation_enabled, high_value_retention_days, policy_source, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'platform_admin', $7)
         RETURNING version`,
        [
          organizationId,
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
      `UPDATE organization_policy_overrides
       SET default_period_quota = $2, warning_ratio = $3, hard_limit = $4,
           degradation_enabled = $5, high_value_retention_days = $6,
           policy_source = 'platform_admin', updated_by = $7, updated_at = now(),
           version = version + 1
       WHERE organization_id = $1 AND version = $8
       RETURNING version`,
      [
        organizationId,
        fields.defaultPeriodQuota,
        fields.warningRatio,
        fields.hardLimit,
        fields.degradationEnabled,
        fields.highValueRetentionDays,
        actorAccountId,
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

/**
 * Delete the organization's override ("restore platform default"). No row →
 * `reset` (idempotent success); a stale version → `version_conflict`. The
 * actor is part of the command interface for the handler-layer audit write and
 * is not written to the row, so no actor existence check is performed here.
 */
export async function resetOrganizationOverride(
  pool: Pool | PoolClient,
  input: { readonly organizationId: string; readonly expectedVersion: number; readonly actorAccountId: string },
): Promise<ResetOrganizationOverrideResult> {
  try {
    requireActorAccountId(input.actorAccountId);
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    const organizationId = input.organizationId.trim();

    const existing = await pool.query<{ version: number }>(
      'SELECT version FROM organization_policy_overrides WHERE organization_id = $1',
      [organizationId],
    );
    const current = existing.rows[0];
    if (current === undefined) return { status: 'reset' };
    if (current.version !== expectedVersion) return { status: 'version_conflict' };

    const deleted = await pool.query<{ organization_id: string }>(
      `DELETE FROM organization_policy_overrides
       WHERE organization_id = $1 AND version = $2
       RETURNING organization_id`,
      [organizationId, expectedVersion],
    );
    if (deleted.rows.length === 0) return { status: 'version_conflict' };
    return { status: 'reset' };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    return { status: 'temporarily_unavailable' };
  }
}
