import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAuditEvent } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-identity audit repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetIdentitySchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('insertAuditEvent persists a row with the supplied detail', async () => {
    const accountId = crypto.randomUUID();
    const result = await insertAuditEvent(pool, {
      actorAccountId: accountId,
      action: 'account.registered',
      targetAccountId: accountId,
      details: { reason: 'register' },
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const row = await queryRow<{
      action: string;
      actor_account_id: string | null;
      details: unknown;
    }>(
      pool,
      'SELECT action, actor_account_id, details FROM security_audit_events WHERE event_id = $1',
      [result.eventId],
    );
    expect(row?.action).toBe('account.registered');
    expect(row?.actor_account_id).toBe(accountId);
    expect(row?.details).toEqual({ reason: 'register' });
  });

  it('insertAuditEvent tolerates null org/actor/target and defaults details to {}', async () => {
    const result = await insertAuditEvent(pool, {
      action: 'email.verified',
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const row = await queryRow<{
      organization_id: string | null;
      actor_account_id: string | null;
      target_account_id: string | null;
      details: unknown;
    }>(
      pool,
      'SELECT organization_id, actor_account_id, target_account_id, details FROM security_audit_events WHERE event_id = $1',
      [result.eventId],
    );
    expect(row?.organization_id).toBeNull();
    expect(row?.actor_account_id).toBeNull();
    expect(row?.target_account_id).toBeNull();
    expect(row?.details).toEqual({});
  });

  it('persists an organization-scoped identity event', async () => {
    const organizationId = crypto.randomUUID();
    const result = await insertAuditEvent(pool, {
      organizationId,
      action: 'invitation.accepted',
      targetAccountId: crypto.randomUUID(),
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const row = await queryRow<{ organization_id: string | null }>(
      pool,
      'SELECT organization_id FROM security_audit_events WHERE event_id = $1',
      [result.eventId],
    );
    expect(row?.organization_id).toBe(organizationId);
  });
});
