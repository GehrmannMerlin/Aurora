import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countOrganizationOwners,
  isUniqueOrganizationOwner,
  listAccountOrganizations,
} from '../../src/index.js';
import {
  addTestMember,
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPersonalOrganization,
  createTestPool,
  resetOrganizationSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization ownership read repository (real PostgreSQL 17)', () => {
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

  /** Set an org's created_at so ordering assertions are deterministic. */
  async function backdateOrg(orgId: string, interval: string): Promise<void> {
    await pool.query(
      `UPDATE organizations SET created_at = now() - interval '${interval}' WHERE organization_id = $1`,
      [orgId],
    );
  }

  it('listAccountOrganizations returns memberships with kind/role, oldest org first', async () => {
    const accountId = await createTestAccount(pool, `acct-${crypto.randomUUID()}@example.com`);
    // orgA created now, orgC backdated 2 hours, orgB backdated 1 day: ordering
    // by created_at ASC is then deterministic.
    const orgA = await createTestOrganization(pool, 'Acme', accountId);
    const orgB = await createTestPersonalOrganization(pool, 'Home', accountId);
    const orgC = await createTestOrganization(pool, 'Globex', accountId);
    await backdateOrg(orgC, '2 hours');
    await backdateOrg(orgB, '1 day');

    // The account is also a plain member of another account's org (created last,
    // so it sorts after orgA).
    const stranger = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const orgD = await createTestOrganization(pool, 'Initech', stranger);
    await addTestMember(pool, orgD, accountId, 'member');

    const memberships = await listAccountOrganizations(pool, accountId);
    expect(memberships).toHaveLength(4);
    // Oldest first: Home (1 day ago), Globex (2 hours ago), Acme (now), Initech (last).
    expect(memberships.map((m) => m.organizationId)).toEqual([orgB, orgC, orgA, orgD]);
    const byId = Object.fromEntries(memberships.map((m) => [m.organizationId, m]));
    expect(byId[orgA]).toMatchObject({ name: 'Acme', kind: 'organization', role: 'owner' });
    expect(byId[orgB]).toMatchObject({ name: 'Home', kind: 'personal', role: 'owner' });
    expect(byId[orgC]).toMatchObject({ name: 'Globex', kind: 'organization', role: 'owner' });
    expect(byId[orgD]).toMatchObject({ name: 'Initech', kind: 'organization', role: 'member' });
  });

  it('listAccountOrganizations returns an empty array for an account with no memberships', async () => {
    const loner = await createTestAccount(pool, `loner-${crypto.randomUUID()}@example.com`);
    expect(await listAccountOrganizations(pool, loner)).toEqual([]);
  });

  it('countOrganizationOwners returns the owner count and 0 for an unknown org', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    expect(await countOrganizationOwners(pool, orgId)).toBe(1);

    // A second owner is normally unreachable under the owner invariant, so this
    // uses raw SQL to exercise the count > 1 path (read-only).
    const secondOwner = await createTestAccount(pool, `owner2-${crypto.randomUUID()}@example.com`);
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, secondOwner],
    );
    expect(await countOrganizationOwners(pool, orgId)).toBe(2);

    expect(await countOrganizationOwners(pool, crypto.randomUUID())).toBe(0);
  });

  it('isUniqueOrganizationOwner is true only for a sole owner', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const adminId = await createTestAccount(pool, `admin-${crypto.randomUUID()}@example.com`);
    const strangerId = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    await addTestMember(pool, orgId, adminId, 'admin');

    // The sole owner is unique.
    expect(await isUniqueOrganizationOwner(pool, { orgId, accountId: ownerId })).toBe(true);

    // A non-owner member is not a unique owner.
    expect(await isUniqueOrganizationOwner(pool, { orgId, accountId: adminId })).toBe(false);

    // A non-member is not a unique owner.
    expect(await isUniqueOrganizationOwner(pool, { orgId, accountId: strangerId })).toBe(false);

    // An unknown org is never a unique owner.
    expect(
      await isUniqueOrganizationOwner(pool, { orgId: crypto.randomUUID(), accountId: ownerId }),
    ).toBe(false);

    // After a second owner is added (raw SQL; degraded state), neither is unique.
    const secondOwner = await createTestAccount(pool, `owner2-${crypto.randomUUID()}@example.com`);
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, secondOwner],
    );
    expect(await isUniqueOrganizationOwner(pool, { orgId, accountId: ownerId })).toBe(false);
    expect(await isUniqueOrganizationOwner(pool, { orgId, accountId: secondOwner })).toBe(false);
    expect(await countOrganizationOwners(pool, orgId)).toBe(2);
  });

  it('ownership reads accept a leased PoolClient for composition', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    const client = await pool.connect();
    try {
      expect(await countOrganizationOwners(client, orgId)).toBe(1);
      expect(await isUniqueOrganizationOwner(client, { orgId, accountId: ownerId })).toBe(true);
      const memberships = await listAccountOrganizations(client, ownerId);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.organizationId).toBe(orgId);
    } finally {
      client.release();
    }
  });
});
