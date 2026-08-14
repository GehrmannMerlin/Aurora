import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAccount,
  findAccountByEmailNormalized,
  getAccountById,
  getAccountByIdForUpdate,
  incrementSecurityVersion,
  updateAccountVerifiedAt,
  upsertAccountCredential,
} from '../../src/index.js';
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

describeDb('platform-identity accounts repository (real PostgreSQL 17)', () => {
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

  function freshAccountEmail(): Promise<string> {
    const suffix = crypto.randomUUID();
    return Promise.resolve(`user-${suffix}@example.com`);
  }

  it('createAccount inserts the account and its initial credential', async () => {
    const email = await freshAccountEmail();
    const result = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: '$argon2id$fake$hash',
      status: 'active',
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.account.email).toBe(email);
    expect(result.account.emailNormalized).toBe(email.toLowerCase());
    expect(result.account.passwordHash).toBe('$argon2id$fake$hash');
    expect(result.account.passwordVersion).toBe(1);
    expect(result.account.securityVersion).toBe(0);
    expect(result.account.verifiedAt).toBeNull();
    expect(result.account.status).toBe('active');
    expect(result.account.accountId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const credential = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_credentials WHERE account_id = $1',
      [result.account.accountId],
    );
    expect(credential[0]?.n).toBe(1);
  });

  it('createAccount returns conflict for a duplicate email', async () => {
    const email = await freshAccountEmail();
    const first = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash-a',
      status: 'active',
    });
    expect(first.status).toBe('success');
    const second = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash-b',
      status: 'active',
    });
    expect(second.status).toBe('conflict');
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM accounts WHERE email_normalized = $1',
      [email.toLowerCase()],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('createAccount rolls back on a statement failure and leaves no account', async () => {
    const email = await freshAccountEmail();
    const beforeAccounts = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM accounts',
    );
    const beforeCredentials = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_credentials',
    );
    await expect(
      createAccount(pool, {
        email,
        emailNormalized: email.toLowerCase(),
        passwordHash: 'hash',
        status: 'bogus-status' as 'active',
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    const afterAccounts = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM accounts',
    );
    expect(afterAccounts[0]?.n).toBe(beforeAccounts[0]?.n);
    const afterCredentials = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM account_credentials',
    );
    expect(afterCredentials[0]?.n).toBe(beforeCredentials[0]?.n);
    const failed = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM accounts WHERE email_normalized = $1',
      [email.toLowerCase()],
    );
    expect(failed[0]?.n).toBe(0);
  });

  it('findAccountByEmailNormalized finds by the canonical form only', async () => {
    const email = await freshAccountEmail();
    await createAccount(pool, {
      email: `  ${email} `,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    const found = await findAccountByEmailNormalized(pool, email.toLowerCase());
    expect(found?.emailNormalized).toBe(email.toLowerCase());
    const missing = await findAccountByEmailNormalized(pool, 'nobody@example.com');
    expect(missing).toBeNull();
  });

  it('getAccountById returns the account and credential; null for unknown', async () => {
    const email = await freshAccountEmail();
    const created = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (created.status !== 'success') throw new Error('expected account creation');
    const found = await getAccountById(pool, created.account.accountId);
    expect(found?.accountId).toBe(created.account.accountId);
    expect(found?.passwordHash).toBe('hash');
    const missing = await getAccountById(pool, crypto.randomUUID());
    expect(missing).toBeNull();
  });

  it('getAccountByIdForUpdate serializes concurrent account work', async () => {
    const email = await freshAccountEmail();
    const created = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'pending_verification',
    });
    if (created.status !== 'success') throw new Error('expected account creation');

    const first: PoolClient = await pool.connect();
    const second: PoolClient = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await getAccountByIdForUpdate(first, created.account.accountId);

      let secondResolved = false;
      const secondLock = getAccountByIdForUpdate(second, created.account.accountId).then((row) => {
        secondResolved = true;
        return row;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondResolved).toBe(false);

      await first.query('COMMIT');
      expect((await secondLock)?.accountId).toBe(created.account.accountId);
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it('updateAccountVerifiedAt activates only a pending verification account', async () => {
    const email = await freshAccountEmail();
    const created = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'pending_verification',
    });
    if (created.status !== 'success') throw new Error('expected account creation');
    const now = new Date('2026-08-09T00:00:00.000Z');
    const updated = await updateAccountVerifiedAt(pool, created.account.accountId, now);
    expect(updated).toEqual({ status: 'success' });
    const row = await queryRow<{ verified_at: string | null; status: string }>(
      pool,
      'SELECT verified_at, status FROM accounts WHERE account_id = $1',
      [created.account.accountId],
    );
    expect(row?.verified_at).not.toBeNull();
    expect(toIso(row?.verified_at)).toBe(now.toISOString());
    expect(row?.status).toBe('active');

    const activeEmail = await freshAccountEmail();
    const alreadyActive = await createAccount(pool, {
      email: activeEmail,
      emailNormalized: activeEmail.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (alreadyActive.status !== 'success') throw new Error('expected active account creation');
    const rejected = await updateAccountVerifiedAt(pool, alreadyActive.account.accountId, now);
    expect(rejected).toEqual({ status: 'not_found' });
    const unchanged = await queryRow<{ verified_at: string | null; status: string }>(
      pool,
      'SELECT verified_at, status FROM accounts WHERE account_id = $1',
      [alreadyActive.account.accountId],
    );
    expect(unchanged).toEqual({ verified_at: null, status: 'active' });

    const missing = await updateAccountVerifiedAt(pool, crypto.randomUUID(), now);
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('incrementSecurityVersion increments the version', async () => {
    const email = await freshAccountEmail();
    const created = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (created.status !== 'success') throw new Error('expected account creation');
    const bumped = await incrementSecurityVersion(pool, created.account.accountId);
    expect(bumped).toEqual({ status: 'success', securityVersion: 1 });
    const missing = await incrementSecurityVersion(pool, crypto.randomUUID());
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('upsertAccountCredential replaces the hash and version; not_found for unknown account', async () => {
    const email = await freshAccountEmail();
    const created = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash-v1',
      status: 'active',
    });
    if (created.status !== 'success') throw new Error('expected account creation');
    const result = await upsertAccountCredential(pool, {
      accountId: created.account.accountId,
      passwordHash: 'hash-v2',
      passwordVersion: 2,
    });
    expect(result).toEqual({ status: 'success' });
    const row = await queryRow<{ password_hash: string; password_version: number }>(
      pool,
      'SELECT password_hash, password_version FROM account_credentials WHERE account_id = $1',
      [created.account.accountId],
    );
    expect(row?.password_hash).toBe('hash-v2');
    expect(row?.password_version).toBe(2);
    const missing = await upsertAccountCredential(pool, {
      accountId: crypto.randomUUID(),
      passwordHash: 'hash',
      passwordVersion: 1,
    });
    expect(missing).toEqual({ status: 'not_found' });
  });
});
