import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, revokeClientKey } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRow,
  queryRows,
  resetProjectGovernanceSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;
describeDb('platform-project-governance client keys repository (real PostgreSQL 17)', () => {
  let pool: Pool;
  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetProjectGovernanceSchema(pool);
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
  it('revokeClientKey disables the key irreversibly and writes audit', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Keys',
      frameworkType: 'react',
      createdBy: ownerId,
    });

    const result = await revokeClientKey(pool, {
      orgId,
      projectId: created.projectId,
      clientKeyId: created.clientKeyId,
      actorId: ownerId,
    });
    expect(result).toEqual({
      status: 'success',
      clientKeyId: created.clientKeyId,
      projectId: created.projectId,
    });
    const key = await queryRow<{ enabled: boolean }>(
      pool,
      'SELECT enabled FROM client_keys WHERE client_key_id = $1',
      [created.clientKeyId],
    );
    expect(key?.enabled).toBe(false);
    const audit = await queryRows<{ action: string }>(
      pool,
      "SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'client_key.revoked'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
  });
  it('revokeClientKey is idempotent when the key is already disabled', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Already Off',
      frameworkType: 'vue',
      createdBy: ownerId,
    });
    await revokeClientKey(pool, {
      orgId,
      projectId: created.projectId,
      clientKeyId: created.clientKeyId,
      actorId: ownerId,
    });
    const second = await revokeClientKey(pool, {
      orgId,
      projectId: created.projectId,
      clientKeyId: created.clientKeyId,
      actorId: ownerId,
    });
    expect(second.status).toBe('success');
    const key = await queryRow<{ enabled: boolean }>(
      pool,
      'SELECT enabled FROM client_keys WHERE client_key_id = $1',
      [created.clientKeyId],
    );
    expect(key?.enabled).toBe(false);
  });
  it('revokeClientKey returns not_found for a key outside the org/project', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const otherOrgId = await createTestOrganization(pool, 'Other', ownerId);
    const created = await createProject(pool, {
      orgId,
      name: 'Owned',
      frameworkType: 'react',
      createdBy: ownerId,
    });

    // Same key, wrong org.
    const wrongOrg = await revokeClientKey(pool, {
      orgId: otherOrgId,
      projectId: created.projectId,
      clientKeyId: created.clientKeyId,
      actorId: ownerId,
    });
    expect(wrongOrg).toEqual({ status: 'not_found' });
    // Same org, unknown key.
    const wrongKey = await revokeClientKey(pool, {
      orgId,
      projectId: created.projectId,
      clientKeyId: crypto.randomUUID(),
      actorId: ownerId,
    });
    expect(wrongKey).toEqual({ status: 'not_found' });
    // The key must still be enabled (nothing was revoked).
    const key = await queryRow<{ enabled: boolean }>(
      pool,
      'SELECT enabled FROM client_keys WHERE client_key_id = $1',
      [created.clientKeyId],
    );
    expect(key?.enabled).toBe(true);
  });
});
