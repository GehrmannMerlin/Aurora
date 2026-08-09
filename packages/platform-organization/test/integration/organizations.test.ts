import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findMembership, getOrganizationById } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  resetOrganizationSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization organizations repository (real PostgreSQL 17)', () => {
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

  it('getOrganizationById returns the org with settings version; null for unknown', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    const org = await getOrganizationById(pool, orgId);
    expect(org?.name).toBe('Acme');
    expect(org?.kind).toBe('organization');
    expect(org?.timezone).toBe('UTC');
    expect(org?.settingsVersion).toBe(0);
    expect(org?.organizationId).toBe(orgId);
    const missing = await getOrganizationById(pool, crypto.randomUUID());
    expect(missing).toBeNull();
  });

  it('findMembership returns the membership row; null for a non-member', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    const membership = await findMembership(pool, { orgId, accountId: ownerId });
    expect(membership?.role).toBe('owner');
    expect(membership?.organizationId).toBe(orgId);
    const strangerId = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const missing = await findMembership(pool, { orgId, accountId: strangerId });
    expect(missing).toBeNull();
  });
});
