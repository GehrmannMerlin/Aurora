import type { Pool, PoolClient } from 'pg';
import { PlatformOrganizationError, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

/** IANA timezone validity check; `UTC` and the IANA database are accepted. */
export function isValidTimezone(timezone: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
    return resolved.length > 0;
  } catch {
    return false;
  }
}

/** B4 organization settings projection (timezone + optimistic version). */
export interface OrganizationSettings {
  readonly organizationId: string;
  readonly name: string;
  readonly kind: 'personal' | 'organization';
  readonly timezone: string;
  readonly settingsVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateTimezoneInput {
  readonly orgId: string;
  readonly timezone: string;
  readonly expectedVersion: number;
  readonly actorId: string;
}

export type UpdateTimezoneResult =
  | {
      readonly status: 'success';
      readonly organizationId: string;
      readonly timezone: string;
      readonly settingsVersion: number;
    }
  | { readonly status: 'version_conflict'; readonly currentSettingsVersion: number }
  | { readonly status: 'not_found' };

interface SettingsRowShape {
  organization_id: string;
  name: string;
  kind: 'personal' | 'organization';
  timezone: string;
  settings_version: number;
  created_at: string;
  updated_at: string;
}

/** Read the B4 organization settings (timezone + settings_version). */
export async function getOrganizationSettings(
  pool: Pool | PoolClient,
  orgId: string,
): Promise<OrganizationSettings | null> {
  try {
    const result = await pool.query<SettingsRowShape>(
      `SELECT organization_id, name, kind, timezone, settings_version, created_at, updated_at
       FROM organizations
       WHERE organization_id = $1`,
      [orgId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      organizationId: row.organization_id,
      name: row.name,
      kind: row.kind,
      timezone: row.timezone,
      settingsVersion: row.settings_version,
      createdAt: isoTimestamp(row.created_at),
      updatedAt: isoTimestamp(row.updated_at),
    };
  } catch (error) {
    throw toStableError(error);
  }
}

async function runUpdateTimezone(
  client: PoolClient,
  input: UpdateTimezoneInput,
): Promise<UpdateTimezoneResult> {
  if (!isValidTimezone(input.timezone)) {
    throw new PlatformOrganizationError('invalid_input', 'invalid timezone');
  }
  const locked = await client.query<{ timezone: string; settings_version: number }>(
    `SELECT timezone, settings_version FROM organizations WHERE organization_id = $1 FOR UPDATE`,
    [input.orgId],
  );
  const row = locked.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (row.settings_version !== input.expectedVersion) {
    return { status: 'version_conflict', currentSettingsVersion: row.settings_version };
  }
  const updated = await client.query<{ settings_version: number }>(
    `UPDATE organizations
       SET timezone = $2, settings_version = settings_version + 1, updated_at = now()
     WHERE organization_id = $1
     RETURNING settings_version`,
    [input.orgId, input.timezone],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow === undefined) {
    throw new PlatformOrganizationError('statement_failed', 'org update returned no row');
  }
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'organization.settings.timezone_updated',
    details: {
      fromTimezone: row.timezone,
      toTimezone: input.timezone,
      expectedVersion: input.expectedVersion,
    },
  });
  return {
    status: 'success',
    organizationId: input.orgId,
    timezone: input.timezone,
    settingsVersion: updatedRow.settings_version,
  };
}

/**
 * Update the organization business timezone with optimistic concurrency.
 * `version_conflict` when `expectedVersion` is stale (412); the server's
 * current version is returned so the caller can re-confirm. Transactional:
 * locks the organization row, bumps `settings_version`, writes audit old/new.
 */
export async function updateOrganizationTimezone(
  pool: Pool | PoolClient,
  input: UpdateTimezoneInput,
): Promise<UpdateTimezoneResult> {
  try {
    return isPoolClient(pool)
      ? await runUpdateTimezone(pool, input)
      : await withTransaction(pool, (client) => runUpdateTimezone(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
