import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlatformApiConfig } from '../src/config.js';
import { problem } from '../src/error-mapper.js';
import { maskEmail } from '../src/routes/register.js';
import { parseIntentCookie, serializeIntentCookie } from '../src/intent-cookie.js';
import {
  readSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from '../src/session-cookie.js';

const { idempotencyLookupMock } = vi.hoisted(() => ({ idempotencyLookupMock: vi.fn() }));
vi.mock('@aurora/platform-identity', () => ({ findIdempotencyRecord: idempotencyLookupMock }));
import { lookupIdempotency } from '../src/idempotency.js';

describe('maskEmail', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail('alice@example.com')).toContain('@example.com');
    expect(maskEmail('alice@example.com')).not.toContain('alice');
  });
  it('keeps a short local part masked', () => {
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
  });
  it('masks a local part with no @ domain', () => {
    expect(maskEmail('no-at-sign')).toBe('no***');
  });
});

describe('parseIntentCookie', () => {
  it('returns null when the intent cookie is absent or malformed', () => {
    expect(parseIntentCookie(undefined)).toBeNull();
    expect(parseIntentCookie('other=x')).toBeNull();
    expect(parseIntentCookie('aurora_intent=only-two:parts')).toBeNull();
    expect(parseIntentCookie('aurora_intent=not_a_kind:tok:sec')).toBeNull();
    expect(parseIntentCookie('aurora_intent=email_verification::sec')).toBeNull();
    expect(parseIntentCookie('aurora_intent=email_verification:tok:')).toBeNull();
  });

  it('parses a well-formed intent cookie into the safe payload', () => {
    expect(parseIntentCookie('aurora_intent=email_verification:tok123:sec456')).toEqual({
      kind: 'email_verification',
      token: 'tok123',
      csrfSecret: 'sec456',
    });
  });
});

describe('serializeIntentCookie', () => {
  const options = {
    httpOnly: true as const,
    secure: true,
    sameSite: 'lax' as const,
    path: '/' as const,
  };

  it('emits Secure, capitalized SameSite and a floored Max-Age', () => {
    const header = serializeIntentCookie('email_verification', 'tok', 'sec', options, 1500);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=1');
  });

  it('omits Secure and floors a sub-second Max-Age to 0', () => {
    const header = serializeIntentCookie(
      'password_reset',
      'tok',
      'sec',
      { ...options, secure: false },
      500,
    );
    expect(header).not.toContain('Secure');
    expect(header).toContain('Max-Age=0');
  });
});

describe('session cookie serialization', () => {
  const options = {
    httpOnly: true as const,
    secure: true,
    sameSite: 'lax' as const,
    path: '/' as const,
  };

  it('emits HttpOnly, Secure, SameSite=Lax and Path=/', () => {
    const header = serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque', options);
    expect(header).toBe(`${SESSION_COOKIE_NAME}=opaque; HttpOnly; Secure; SameSite=Lax; Path=/`);
  });
  it('omits Secure when the config disables it', () => {
    const header = serializeSessionCookie(SESSION_COOKIE_NAME, 'opaque', {
      ...options,
      secure: false,
    });
    expect(header).not.toContain('Secure');
  });
});

describe('readSessionCookie', () => {
  it('parses the aurora_session value', () => {
    expect(readSessionCookie('other=a; aurora_session=opaque-value; foo=b')).toBe('opaque-value');
  });
  it('returns undefined when absent or empty', () => {
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie('other=only')).toBeUndefined();
    expect(readSessionCookie('aurora_session=; other=1')).toBeUndefined();
  });
});

describe('problem (RFC 9457)', () => {
  it('builds a closed problem with the request id', () => {
    const value = problem('req-1', 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    expect(value).toMatchObject({
      type: 'about:blank',
      status: 401,
      code: 'authentication',
      requestId: 'req-1',
      recoveryTarget: 'auth.login',
    });
  });
  it('omits optional fields when not supplied', () => {
    const value = problem('req-2', 500, 'internal_error', 'An internal error occurred.');
    expect('recoveryTarget' in value).toBe(false);
    expect('retryAfter' in value).toBe(false);
  });
});

describe('loadPlatformApiConfig', () => {
  it('requires DATABASE_URL and REDIS_URL and applies defaults', () => {
    const config = loadPlatformApiConfig({
      DATABASE_URL: 'postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test',
      REDIS_URL: 'redis://localhost:16379',
      PORT: '0',
    });
    expect(config.sessionIdleMs).toBe(30 * 60 * 1000);
    expect(config.sessionAbsoluteMs).toBe(8 * 60 * 60 * 1000);
    expect(config.cookieSecure).toBe(false);
    expect(config.appOrigins).toEqual([]);
    expect(config.port).toBe(0);
  });
  it('rejects a non-numeric PORT', () => {
    expect(() =>
      loadPlatformApiConfig({
        DATABASE_URL: 'postgresql://localhost/db',
        REDIS_URL: 'redis://localhost:6379',
        PORT: 'not-a-number',
      }),
    ).toThrow(/PORT/);
  });
  it('parses PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS into platformAdminBootstrapAccountIds', () => {
    const config = loadPlatformApiConfig({
      DATABASE_URL: 'postgresql://localhost/db',
      REDIS_URL: 'redis://localhost:6379',
      PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS:
        '11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222',
    });
    expect(config.platformAdminBootstrapAccountIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });
  it('defaults platformAdminBootstrapAccountIds to an empty list', () => {
    const config = loadPlatformApiConfig({
      DATABASE_URL: 'postgresql://localhost/db',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(config.platformAdminBootstrapAccountIds).toEqual([]);
  });
  it('skips non-UUID PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS entries with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const config = loadPlatformApiConfig({
        DATABASE_URL: 'postgresql://localhost/db',
        REDIS_URL: 'redis://localhost:6379',
        PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS: 'not-a-uuid,11111111-1111-4111-8111-111111111111,,  ',
      });
      expect(config.platformAdminBootstrapAccountIds).toEqual([
        '11111111-1111-4111-8111-111111111111',
      ]);
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('lookupIdempotency', () => {
  const pool = {} as never;

  afterEach(() => {
    idempotencyLookupMock.mockReset();
  });

  it('returns new when no record exists', async () => {
    idempotencyLookupMock.mockResolvedValue(null);
    await expect(lookupIdempotency(pool, 'key', 'digest')).resolves.toEqual({ outcome: 'new' });
  });

  it('returns conflict when a non-terminal record has the same digest (fail closed)', async () => {
    idempotencyLookupMock.mockResolvedValue({
      idempotencyKey: 'key',
      operation: 'op',
      requestDigest: 'digest',
      status: 'processing',
      resultData: null,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    await expect(lookupIdempotency(pool, 'key', 'digest')).resolves.toEqual({
      outcome: 'conflict',
    });
  });

  it('returns conflict when the key has a different digest', async () => {
    idempotencyLookupMock.mockResolvedValue({
      idempotencyKey: 'key',
      operation: 'op',
      requestDigest: 'other',
      status: 'succeeded',
      resultData: { ok: true },
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    await expect(lookupIdempotency(pool, 'key', 'digest')).resolves.toEqual({
      outcome: 'conflict',
    });
  });

  it('returns replay when a succeeded record matches the digest', async () => {
    idempotencyLookupMock.mockResolvedValue({
      idempotencyKey: 'key',
      operation: 'op',
      requestDigest: 'digest',
      status: 'succeeded',
      resultData: { ok: true },
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    await expect(lookupIdempotency(pool, 'key', 'digest')).resolves.toEqual({
      outcome: 'replay',
      resultData: { ok: true },
    });
  });
});
