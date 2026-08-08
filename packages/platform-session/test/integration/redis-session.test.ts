import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import {
  createSession,
  createSessionStore,
  getSession,
  revokeAllAccountSessions,
  revokeSession,
  rotateSession,
  type SessionStore,
} from '../../src/session-store.js';

const redisUrl = process.env.AURORA_TEST_REDIS_URL;
const hasRedis = redisUrl !== undefined;
const describeRedis = hasRedis ? describe : describe.skip;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describeRedis('platform-session Redis store', () => {
  let store: SessionStore;
  const now = new Date('2026-08-09T00:00:00.000Z');
  const idleMs = 30 * 60 * 1000; // 30 minutes idle TTL
  const absoluteMs = 8 * 60 * 60 * 1000; // 8 hours absolute
  const accountId = `account-${randomUUID()}`;
  const otherAccountId = `account-${randomUUID()}`;

  beforeAll(async () => {
    if (redisUrl === undefined) {
      throw new Error('AURORA_TEST_REDIS_URL must be set for integration tests');
    }
    store = await createSessionStore({
      url: redisUrl,
      keyPrefix: `test:platform-session:${sha256(randomUUID())}`,
    });
  });

  afterAll(async () => {
    const keys = await store.client.keys(`${store.keyPrefix}:*`);
    if (keys.length > 0) {
      await store.client.del(keys);
    }
    await store.client.quit();
  });

  it('stores only the SHA-256 digest of the session id, never the raw value', async () => {
    const created = await createSession(store, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    const digest = sha256(created.cookieValue);
    const sessionKey = `${store.keyPrefix}:${digest}`;
    const raw = await store.client.get(sessionKey);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(created.cookieValue);
    if (raw === null) {
      throw new Error('expected session payload');
    }
    const parsed = JSON.parse(raw) as {
      accountId: string;
      authLevel: string;
      csrfSecret: string;
    };
    expect(parsed.accountId).toBe(accountId);
    expect(parsed.authLevel).toBe('authenticated');
    expect(parsed.csrfSecret).toBeTruthy();
    expect(digest).not.toBe(created.cookieValue);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the session payload for a valid session', async () => {
    const created = await createSession(store, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    const payload = await getSession(store, created.cookieValue, new Date(now.getTime() + 60_000));
    expect(payload).not.toBeNull();
    expect(payload?.accountId).toBe(accountId);
    expect(payload?.authLevel).toBe('authenticated');
    expect(payload?.expiresAt).toBe(created.expiresAt);
    expect(payload?.rotationDueAt).toBeNull();
  });

  it('returns null for a missing session', async () => {
    const payload = await getSession(store, 'missing-cookie-value', now);
    expect(payload).toBeNull();
  });

  it('rotate invalidates the old session and creates a new one', async () => {
    const created = await createSession(store, {
      accountId,
      authLevel: 'pending_verification',
      now,
      idleMs,
      absoluteMs,
    });
    const later = new Date(now.getTime() + 60_000);
    const rotated = await rotateSession(store, created.cookieValue, later, {
      accountId,
      authLevel: 'authenticated',
      now: later,
      idleMs,
      absoluteMs,
    });
    if (rotated === null) {
      throw new Error('expected rotateSession to return a new session');
    }
    expect(rotated.cookieValue).not.toBe(created.cookieValue);
    expect(
      await getSession(store, created.cookieValue, new Date(later.getTime() + 1_000)),
    ).toBeNull();
    const payload = await getSession(store, rotated.cookieValue, new Date(later.getTime() + 1_000));
    expect(payload?.authLevel).toBe('authenticated');
  });

  it('rotate returns null for a missing session', async () => {
    const rotated = await rotateSession(store, 'not-a-session', now, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    expect(rotated).toBeNull();
  });

  it('revoke removes the session and its account-set membership', async () => {
    const created = await createSession(store, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    await revokeSession(store, created.cookieValue);
    expect(
      await getSession(store, created.cookieValue, new Date(now.getTime() + 60_000)),
    ).toBeNull();
    const members = await store.client.sMembers(`${store.keyPrefix}:account:${accountId}`);
    expect(members).not.toContain(sha256(created.cookieValue));
  });

  it('revokeAll removes every session for the account and leaves other accounts untouched', async () => {
    const first = await createSession(store, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    const second = await createSession(store, {
      accountId,
      authLevel: 'restricted',
      now,
      idleMs,
      absoluteMs,
    });
    const other = await createSession(store, {
      accountId: otherAccountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs,
    });
    await revokeAllAccountSessions(store, accountId);
    expect(await getSession(store, first.cookieValue, new Date(now.getTime() + 60_000))).toBeNull();
    expect(
      await getSession(store, second.cookieValue, new Date(now.getTime() + 60_000)),
    ).toBeNull();
    expect(
      await getSession(store, other.cookieValue, new Date(now.getTime() + 60_000)),
    ).not.toBeNull();
    const members = await store.client.sMembers(`${store.keyPrefix}:account:${accountId}`);
    expect(members).toHaveLength(0);
  });

  it('returns null for an absolutely-expired session even when the key still exists', async () => {
    const created = await createSession(store, {
      accountId,
      authLevel: 'authenticated',
      now,
      idleMs,
      absoluteMs: 1_000,
    });
    const later = new Date(now.getTime() + 10_000);
    expect(await getSession(store, created.cookieValue, later)).toBeNull();
    // idle TTL (30 min) has not elapsed, so the key may still exist — absolute
    // expiry is enforced by the stored expiresAt check, not by Redis.
    const raw = await store.client.get(`${store.keyPrefix}:${sha256(created.cookieValue)}`);
    expect(raw).not.toBeNull();
  });

  it('revoke is a no-op for a session that does not exist', async () => {
    await expect(revokeSession(store, 'never-created-cookie')).resolves.toBeUndefined();
    expect(
      await getSession(store, 'never-created-cookie', new Date(now.getTime() + 60_000)),
    ).toBeNull();
  });

  it('createSessionStore defaults to the aurora platform session key prefix', async () => {
    if (redisUrl === undefined) {
      throw new Error('AURORA_TEST_REDIS_URL must be set for integration tests');
    }
    const defaultStore = await createSessionStore({ url: redisUrl });
    expect(defaultStore.keyPrefix).toBe('aurora:platform:session');
    await defaultStore.client.quit();
  });
});
