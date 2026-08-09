import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumeIntent,
  createAccount,
  findEmailVerificationIntentByDigest,
  findPasswordResetIntentByDigest,
  insertEmailVerificationIntent,
  insertPasswordResetIntent,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
  toIso,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-identity intents repository (real PostgreSQL 17)', () => {
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
    const email = `intent-${suffix}@example.com`;
    const result = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (result.status !== 'success') throw new Error('expected account creation');
    return result.account.accountId;
  }

  it('insertEmailVerificationIntent persists a row with the digest only', async () => {
    const accountId = await createFreshAccountId();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const result = await insertEmailVerificationIntent(pool, {
      accountId,
      tokenDigest: 'a'.repeat(64),
      expiresAt,
    });
    expect(result.status).toBe('success');
    const row = await queryRow<{
      token_digest: string;
      consumed_at: string | null;
      expires_at: string;
    }>(
      pool,
      'SELECT token_digest, consumed_at, expires_at FROM email_verification_intents WHERE intent_id = $1',
      [result.intentId],
    );
    expect(row?.token_digest).toBe('a'.repeat(64));
    expect(row?.consumed_at).toBeNull();
    expect(toIso(row?.expires_at)).toBe(expiresAt.toISOString());
  });

  it('insertPasswordResetIntent persists a row', async () => {
    const accountId = await createFreshAccountId();
    const result = await insertPasswordResetIntent(pool, {
      accountId,
      tokenDigest: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    expect(result.status).toBe('success');
    const row = await queryRow<{ token_digest: string }>(
      pool,
      'SELECT token_digest FROM password_reset_intents WHERE intent_id = $1',
      [result.intentId],
    );
    expect(row?.token_digest).toBe('b'.repeat(64));
  });

  it('findEmailVerificationIntentByDigest finds by digest; null for unknown', async () => {
    const accountId = await createFreshAccountId();
    await insertEmailVerificationIntent(pool, {
      accountId,
      tokenDigest: 'c'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const found = await findEmailVerificationIntentByDigest(pool, 'c'.repeat(64));
    expect(found?.tokenDigest).toBe('c'.repeat(64));
    expect(found?.accountId).toBe(accountId);
    const missing = await findEmailVerificationIntentByDigest(pool, 'd'.repeat(64));
    expect(missing).toBeNull();
  });

  it('findPasswordResetIntentByDigest finds by digest; null for unknown', async () => {
    const accountId = await createFreshAccountId();
    await insertPasswordResetIntent(pool, {
      accountId,
      tokenDigest: 'e'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const found = await findPasswordResetIntentByDigest(pool, 'e'.repeat(64));
    expect(found?.tokenDigest).toBe('e'.repeat(64));
    const missing = await findPasswordResetIntentByDigest(pool, 'f'.repeat(64));
    expect(missing).toBeNull();
  });

  it('consumeIntent succeeds once then returns already_consumed', async () => {
    const accountId = await createFreshAccountId();
    const inserted = await insertEmailVerificationIntent(pool, {
      accountId,
      tokenDigest: 'g'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const now = new Date(Date.now() + 60_000);
    const first = await consumeIntent(pool, {
      kind: 'email_verification',
      intentId: inserted.intentId,
      now,
    });
    expect(first).toEqual({ status: 'success' });
    const second = await consumeIntent(pool, {
      kind: 'email_verification',
      intentId: inserted.intentId,
      now: new Date(now.getTime() + 1_000),
    });
    expect(second).toEqual({ status: 'already_consumed' });
    const row = await queryRow<{ consumed_at: string | null }>(
      pool,
      'SELECT consumed_at FROM email_verification_intents WHERE intent_id = $1',
      [inserted.intentId],
    );
    expect(row?.consumed_at).not.toBeNull();
    expect(toIso(row?.consumed_at)).toBe(now.toISOString());
  });

  it('consumeIntent returns expired when past expires_at', async () => {
    const accountId = await createFreshAccountId();
    const past = new Date(Date.now() - 60_000);
    const inserted = await insertPasswordResetIntent(pool, {
      accountId,
      tokenDigest: 'h'.repeat(64),
      expiresAt: past,
    });
    const result = await consumeIntent(pool, {
      kind: 'password_reset',
      intentId: inserted.intentId,
      now: new Date(),
    });
    expect(result).toEqual({ status: 'expired' });
    const row = await queryRow<{ consumed_at: string | null }>(
      pool,
      'SELECT consumed_at FROM password_reset_intents WHERE intent_id = $1',
      [inserted.intentId],
    );
    expect(row?.consumed_at).toBeNull();
  });

  it('consumeIntent returns not_found for an unknown id', async () => {
    const result = await consumeIntent(pool, {
      kind: 'email_verification',
      intentId: crypto.randomUUID(),
      now: new Date(),
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('keeps email_verification and password_reset intents fully separate', async () => {
    const accountId = await createFreshAccountId();
    const inserted = await insertEmailVerificationIntent(pool, {
      accountId,
      tokenDigest: 'i'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    // Same id, wrong table => not_found.
    const wrong = await consumeIntent(pool, {
      kind: 'password_reset',
      intentId: inserted.intentId,
      now: new Date(),
    });
    expect(wrong).toEqual({ status: 'not_found' });
  });
});
