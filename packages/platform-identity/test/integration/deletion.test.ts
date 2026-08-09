import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumeDeletionIntent,
  createAccount,
  findAccountByEmailNormalized,
  findCleanupHandoffByAccount,
  findDeletionIntentByDigest,
  getAccountById,
  getAccountByIdForUpdate,
  incrementSecurityVersion,
  insertCleanupHandoff,
  insertDeletionIntent,
  recordDeletionRequest,
  recordDeletionTermination,
  updateAccountStatus,
  updateAccountVerifiedAt,
  upsertAccountCredential,
} from '../../src/index.js';
import { withTransaction } from '../../src/repositories/transaction.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
  toIso,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface CountRow {
  n: number;
}

describeDb('platform-identity account deletion data layer (real PostgreSQL 17)', () => {
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

  async function createFreshAccountId(): Promise<string> {
    const suffix = crypto.randomUUID();
    const email = `deletion-${suffix}@example.com`;
    const result = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (result.status !== 'success') throw new Error('expected account creation');
    return result.account.accountId;
  }

  const REQUIRED_LIFECYCLE: Readonly<Record<string, unknown>> = {
    onlineCleanupDays: 7,
    auditRetentionYears: 1,
    backupRetentionDays: 35,
  };

  it('migration creates the deletion tables and the accounts timeline columns', async () => {
    const intentsTable = await queryRow<{ cls: string | null }>(
      pool,
      `SELECT to_regclass('public.account_deletion_intents') AS cls`,
    );
    expect(intentsTable?.cls).toBe('account_deletion_intents');
    const handoffsTable = await queryRow<{ cls: string | null }>(
      pool,
      `SELECT to_regclass('public.account_cleanup_handoffs') AS cls`,
    );
    expect(handoffsTable?.cls).toBe('account_cleanup_handoffs');

    const columns = await queryRows<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'accounts'
         AND column_name IN ('deletion_requested_at','deletion_cooling_ends_at','deletion_terminated_at')
       ORDER BY column_name`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'deletion_cooling_ends_at',
      'deletion_requested_at',
      'deletion_terminated_at',
    ]);
  });

  it('recordDeletionRequest transitions to deletion_cooling and bumps security_version atomically', async () => {
    const accountId = await createFreshAccountId();
    const now = new Date('2026-08-09T00:00:00.000Z');
    const coolingEndsAt = new Date('2026-08-16T00:00:00.000Z');
    const updated = await recordDeletionRequest(pool, { accountId, coolingEndsAt, now });
    expect(updated).toEqual({ status: 'success' });

    const account = await getAccountById(pool, accountId);
    expect(account?.status).toBe('deletion_cooling');
    expect(account?.securityVersion).toBe(1);

    const row = await queryRow<{
      deletion_requested_at: string | null;
      deletion_cooling_ends_at: string | null;
      security_version: number;
    }>(
      pool,
      `SELECT deletion_requested_at, deletion_cooling_ends_at, security_version
       FROM accounts WHERE account_id = $1`,
      [accountId],
    );
    expect(toIso(row?.deletion_requested_at)).toBe(now.toISOString());
    expect(toIso(row?.deletion_cooling_ends_at)).toBe(coolingEndsAt.toISOString());
    expect(row?.security_version).toBe(1);

    const missing = await recordDeletionRequest(pool, {
      accountId: crypto.randomUUID(),
      coolingEndsAt,
      now,
    });
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('recordDeletionTermination sets terminated and the terminated timestamp', async () => {
    const accountId = await createFreshAccountId();
    const now = new Date('2026-08-16T00:00:00.000Z');
    const updated = await recordDeletionTermination(pool, { accountId, now });
    expect(updated).toEqual({ status: 'success' });

    const account = await getAccountById(pool, accountId);
    expect(account?.status).toBe('terminated');
    const row = await queryRow<{ deletion_terminated_at: string | null }>(
      pool,
      'SELECT deletion_terminated_at FROM accounts WHERE account_id = $1',
      [accountId],
    );
    expect(toIso(row?.deletion_terminated_at)).toBe(now.toISOString());

    const missing = await recordDeletionTermination(pool, {
      accountId: crypto.randomUUID(),
      now,
    });
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('updateAccountStatus round-trips every authoritative status', async () => {
    const accountId = await createFreshAccountId();
    const statuses = ['active', 'pending_verification', 'deletion_cooling', 'terminated'] as const;
    for (const status of statuses) {
      const updated = await updateAccountStatus(pool, {
        accountId,
        status,
        now: new Date(),
      });
      expect(updated).toEqual({ status: 'success' });
      const account = await getAccountById(pool, accountId);
      expect(account?.status).toBe(status);
    }
    const missing = await updateAccountStatus(pool, {
      accountId: crypto.randomUUID(),
      status: 'active',
      now: new Date(),
    });
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('deletion intent insert + find-by-digest is kind-scoped', async () => {
    const accountId = await createFreshAccountId();
    const digest = 'a'.repeat(64);
    const inserted = await insertDeletionIntent(pool, {
      accountId,
      intentKind: 'deletion_request',
      tokenDigest: digest,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    expect(inserted.status).toBe('success');

    const byKind = await findDeletionIntentByDigest(pool, 'deletion_request', digest);
    expect(byKind?.intentId).toBe(inserted.intentId);
    expect(byKind?.accountId).toBe(accountId);
    expect(byKind?.intentKind).toBe('deletion_request');
    expect(byKind?.consumedAt).toBeNull();

    // Same digest under the other kind must not match.
    const wrongKind = await findDeletionIntentByDigest(pool, 'deletion_cancel', digest);
    expect(wrongKind).toBeNull();

    const unknown = await findDeletionIntentByDigest(pool, 'deletion_request', 'b'.repeat(64));
    expect(unknown).toBeNull();
  });

  it('consumeDeletionIntent succeeds once then reports already_consumed', async () => {
    const accountId = await createFreshAccountId();
    const inserted = await insertDeletionIntent(pool, {
      accountId,
      intentKind: 'deletion_request',
      tokenDigest: 'c'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const now = new Date(Date.now() + 60_000);
    const first = await consumeDeletionIntent(pool, { intentId: inserted.intentId, now });
    expect(first).toEqual({ status: 'success' });
    const second = await consumeDeletionIntent(pool, {
      intentId: inserted.intentId,
      now: new Date(now.getTime() + 1_000),
    });
    expect(second).toEqual({ status: 'already_consumed' });
    const row = await queryRow<{ consumed_at: string | null }>(
      pool,
      'SELECT consumed_at FROM account_deletion_intents WHERE intent_id = $1',
      [inserted.intentId],
    );
    expect(row?.consumed_at).not.toBeNull();
    expect(toIso(row?.consumed_at)).toBe(now.toISOString());
  });

  it('consumeDeletionIntent reports expired when past expires_at', async () => {
    const accountId = await createFreshAccountId();
    const past = new Date(Date.now() - 60_000);
    const inserted = await insertDeletionIntent(pool, {
      accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: 'd'.repeat(64),
      expiresAt: past,
    });
    const result = await consumeDeletionIntent(pool, {
      intentId: inserted.intentId,
      now: new Date(),
    });
    expect(result).toEqual({ status: 'expired' });
    const row = await queryRow<{ consumed_at: string | null }>(
      pool,
      'SELECT consumed_at FROM account_deletion_intents WHERE intent_id = $1',
      [inserted.intentId],
    );
    expect(row?.consumed_at).toBeNull();
  });

  it('consumeDeletionIntent reports not_found for an unknown id', async () => {
    const result = await consumeDeletionIntent(pool, {
      intentId: crypto.randomUUID(),
      now: new Date(),
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('insertCleanupHandoff persists then is idempotent; find by account', async () => {
    const accountId = await createFreshAccountId();
    const now = new Date('2026-08-16T00:00:00.000Z');
    const first = await insertCleanupHandoff(pool, {
      accountId,
      requiredLifecycle: REQUIRED_LIFECYCLE,
      now,
    });
    expect(first.status).toBe('success');
    if (first.status !== 'success') return;

    const found = await findCleanupHandoffByAccount(pool, accountId);
    expect(found?.handoffId).toBe(first.handoffId);
    expect(found?.status).toBe('pending');
    expect(found?.attemptCount).toBe(0);
    expect(found?.requiredLifecycle).toEqual(REQUIRED_LIFECYCLE);
    expect(toIso(found?.createdAt)).toBe(now.toISOString());

    const second = await insertCleanupHandoff(pool, {
      accountId,
      requiredLifecycle: REQUIRED_LIFECYCLE,
      now: new Date(now.getTime() + 1_000),
    });
    expect(second).toEqual({ status: 'already_exists' });

    const counts = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [accountId],
    );
    expect(counts[0]?.n).toBe(1);

    const missing = await findCleanupHandoffByAccount(pool, crypto.randomUUID());
    expect(missing).toBeNull();
  });

  it('transaction rollback: accepted deletion + handoff write both revert when the transaction aborts', async () => {
    const accountId = await createFreshAccountId();
    const now = new Date('2026-08-09T00:00:00.000Z');
    const coolingEndsAt = new Date('2026-08-16T00:00:00.000Z');

    await expect(
      withTransaction(pool, async (client) => {
        const request = await recordDeletionRequest(client, {
          accountId,
          coolingEndsAt,
          now,
        });
        expect(request).toEqual({ status: 'success' });
        const handoff = await insertCleanupHandoff(client, {
          accountId,
          requiredLifecycle: REQUIRED_LIFECYCLE,
          now,
        });
        expect(handoff.status).toBe('success');
        throw new Error('simulated abort after accepted deletion');
      }),
    ).rejects.toThrow('simulated abort after accepted deletion');

    // Neither the status transition nor the handoff row may persist.
    const account = await getAccountById(pool, accountId);
    expect(account?.status).toBe('active');
    expect(account?.securityVersion).toBe(0);

    const handoffs = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [accountId],
    );
    expect(handoffs[0]?.n).toBe(0);

    const intents = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_deletion_intents WHERE account_id = $1',
      [accountId],
    );
    expect(intents[0]?.n).toBe(0);
  });

  it('getAccountByIdForUpdate locks and returns the account; null for an unknown id', async () => {
    const accountId = await createFreshAccountId();

    const found = await withTransaction(pool, async (client) => {
      const row = await getAccountByIdForUpdate(client, accountId);
      expect(row?.accountId).toBe(accountId);
      return row;
    });
    expect(found?.status).toBe('active');

    const missing = await withTransaction(pool, async (client) =>
      getAccountByIdForUpdate(client, crypto.randomUUID()),
    );
    expect(missing).toBeNull();
  });

  it('createAccount runs atomically when composed inside a transaction (PoolClient)', async () => {
    const suffix = crypto.randomUUID();
    const email = `deletion-poolclient-${suffix}@example.com`;
    const created = await withTransaction(pool, async (client) =>
      createAccount(client, {
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash: 'hash',
        status: 'active',
      }),
    );
    if (created.status !== 'success') throw new Error('expected account creation');
    expect(created.status).toBe('success');

    const account = await getAccountById(pool, created.account.accountId);
    expect(account?.status).toBe('active');
  });

  it('insertCleanupHandoff surfaces a stable error when the account is absent (FK)', async () => {
    await expect(
      insertCleanupHandoff(pool, {
        accountId: crypto.randomUUID(),
        requiredLifecycle: REQUIRED_LIFECYCLE,
        now: new Date(),
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
  });

  it('insertDeletionIntent surfaces a stable error when the account is absent (FK)', async () => {
    await expect(
      insertDeletionIntent(pool, {
        accountId: crypto.randomUUID(),
        intentKind: 'deletion_request',
        tokenDigest: 'e'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
  });

  it('account/intent repositories surface query failures as stable statement_failed errors', async () => {
    const closed = createTestPool();
    await closed.end();
    const now = new Date();
    const missingId = crypto.randomUUID();

    await expect(getAccountById(closed, missingId)).rejects.toMatchObject({
      kind: 'statement_failed',
    });
    await expect(findAccountByEmailNormalized(closed, 'nobody@example.com')).rejects.toMatchObject({
      kind: 'statement_failed',
    });
    await expect(updateAccountVerifiedAt(closed, missingId, now)).rejects.toMatchObject({
      kind: 'statement_failed',
    });
    await expect(incrementSecurityVersion(closed, missingId)).rejects.toMatchObject({
      kind: 'statement_failed',
    });
    await expect(
      updateAccountStatus(closed, { accountId: missingId, status: 'active', now }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    await expect(
      recordDeletionRequest(closed, { accountId: missingId, coolingEndsAt: now, now }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    await expect(
      recordDeletionTermination(closed, { accountId: missingId, now }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    await expect(
      upsertAccountCredential(closed, {
        accountId: missingId,
        passwordHash: 'hash',
        passwordVersion: 1,
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    await expect(findCleanupHandoffByAccount(closed, missingId)).rejects.toMatchObject({
      kind: 'statement_failed',
    });
    await expect(
      findDeletionIntentByDigest(closed, 'deletion_request', 'a'.repeat(64)),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    await expect(consumeDeletionIntent(closed, { intentId: missingId, now })).rejects.toMatchObject(
      {
        kind: 'statement_failed',
      },
    );
  });

  it('getAccountByIdForUpdate surfaces a stable error when the client connection fails', async () => {
    const dedicated = createTestPool();
    const broken = await dedicated.connect();
    broken.on('error', () => undefined);
    await broken.query('SELECT pg_terminate_backend(pg_backend_pid())').catch(() => undefined);

    await expect(getAccountByIdForUpdate(broken, crypto.randomUUID())).rejects.toMatchObject({
      kind: 'statement_failed',
    });

    broken.release();
    await dedicated.end();
  });
});
