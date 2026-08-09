import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOrganizationSettings, updateOrganizationTimezone } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRows,
  resetOrganizationSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization timezone repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetOrganizationSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOrgWithOwner(): Promise<{ orgId: string; ownerId: string }> {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    return { orgId, ownerId };
  }

  it('getOrganizationSettings returns timezone and settingsVersion', async () => {
    const { orgId } = await createOrgWithOwner();
    const settings = await getOrganizationSettings(pool, orgId);
    expect(settings?.organizationId).toBe(orgId);
    expect(settings?.timezone).toBe('UTC');
    expect(settings?.settingsVersion).toBe(0);
    expect(settings?.kind).toBe('organization');
  });

  it('getOrganizationSettings returns null for an unknown org', async () => {
    const settings = await getOrganizationSettings(pool, crypto.randomUUID());
    expect(settings).toBeNull();
  });

  it('updateOrganizationTimezone updates timezone, bumps version, and writes audit', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const result = await updateOrganizationTimezone(pool, {
      orgId,
      timezone: 'Asia/Shanghai',
      expectedVersion: 0,
      actorId: ownerId,
    });
    expect(result).toEqual({
      status: 'success',
      organizationId: orgId,
      timezone: 'Asia/Shanghai',
      settingsVersion: 1,
    });
    const settings = await getOrganizationSettings(pool, orgId);
    expect(settings?.timezone).toBe('Asia/Shanghai');
    expect(settings?.settingsVersion).toBe(1);
    const audit = await queryRows<{ action: string; details: unknown }>(
      pool,
      "SELECT action, details FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.settings.timezone_updated'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({
      fromTimezone: 'UTC',
      toTimezone: 'Asia/Shanghai',
      expectedVersion: 0,
    });
  });

  it('updateOrganizationTimezone returns version_conflict on a stale version', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    await updateOrganizationTimezone(pool, {
      orgId,
      timezone: 'Asia/Shanghai',
      expectedVersion: 0,
      actorId: ownerId,
    });
    const conflict = await updateOrganizationTimezone(pool, {
      orgId,
      timezone: 'Europe/London',
      expectedVersion: 0,
      actorId: ownerId,
    });
    expect(conflict).toEqual({ status: 'version_conflict', currentSettingsVersion: 1 });
    // The stale update must not have persisted.
    const settings = await getOrganizationSettings(pool, orgId);
    expect(settings?.timezone).toBe('Asia/Shanghai');
  });

  it('updateOrganizationTimezone rejects an invalid timezone', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    await expect(
      updateOrganizationTimezone(pool, {
        orgId,
        timezone: 'Mars/Olympus_Mons',
        expectedVersion: 0,
        actorId: ownerId,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('updateOrganizationTimezone returns not_found for an unknown org', async () => {
    const { ownerId } = await createOrgWithOwner();
    const result = await updateOrganizationTimezone(pool, {
      orgId: crypto.randomUUID(),
      timezone: 'UTC',
      expectedVersion: 0,
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });
});
