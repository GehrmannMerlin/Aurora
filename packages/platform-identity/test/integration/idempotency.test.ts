import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIdempotencyRecord,
  findIdempotencyRecord,
  updateIdempotencyResult,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-identity idempotency repository (real PostgreSQL 17)', () => {
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

  function freshKey(): string {
    return `key-${crypto.randomUUID()}`;
  }

  it('createIdempotencyRecord creates a processing record', async () => {
    const key = freshKey();
    const result = await createIdempotencyRecord(pool, {
      idempotencyKey: key,
      operation: 'identityRegister',
      requestDigest: 'd1'.repeat(32),
      status: 'processing',
    });
    expect(result).toEqual({ status: 'created' });
    const found = await findIdempotencyRecord(pool, key);
    expect(found?.operation).toBe('identityRegister');
    expect(found?.status).toBe('processing');
    expect(found?.requestDigest).toBe('d1'.repeat(32));
  });

  it('createIdempotencyRecord returns conflict on a duplicate key', async () => {
    const key = freshKey();
    const first = await createIdempotencyRecord(pool, {
      idempotencyKey: key,
      operation: 'identityRegister',
      requestDigest: 'd2'.repeat(32),
      status: 'processing',
    });
    expect(first).toEqual({ status: 'created' });
    const second = await createIdempotencyRecord(pool, {
      idempotencyKey: key,
      operation: 'identityLogin',
      requestDigest: 'd3'.repeat(32),
      status: 'processing',
    });
    expect(second).toEqual({ status: 'conflict' });
  });

  it('findIdempotencyRecord returns null for an unknown key', async () => {
    const found = await findIdempotencyRecord(pool, freshKey());
    expect(found).toBeNull();
  });

  it('updateIdempotencyResult records the terminal result; not_found for unknown key', async () => {
    const key = freshKey();
    await createIdempotencyRecord(pool, {
      idempotencyKey: key,
      operation: 'identityRegister',
      requestDigest: 'd4'.repeat(32),
      status: 'processing',
    });
    const result = await updateIdempotencyResult(pool, {
      key,
      status: 'succeeded',
      resultData: { accountId: crypto.randomUUID() },
    });
    expect(result).toEqual({ status: 'success' });
    const found = await findIdempotencyRecord(pool, key);
    expect(found?.status).toBe('succeeded');
    expect(found?.resultData).toEqual({ accountId: expect.any(String) as string });
    const missing = await updateIdempotencyResult(pool, {
      key: freshKey(),
      status: 'failed',
      resultData: null,
    });
    expect(missing).toEqual({ status: 'not_found' });
  });
});
