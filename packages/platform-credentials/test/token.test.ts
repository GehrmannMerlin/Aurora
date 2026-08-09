import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_TOKEN_PREFIX,
  PRIVATE_TOKEN_SCOPES,
  createPrivateTokenValue,
  getTokenStatus,
  isExpired,
  isPrivateTokenScope,
  verifyTokenScope,
} from '../src/token.js';

describe('platform-credentials token helpers', () => {
  it('createPrivateTokenValue returns aurora_pt_<tokenId>_<secret> with a high-entropy secret', () => {
    const tokenId = crypto.randomUUID();
    const { tokenPlaintext, digest } = createPrivateTokenValue(tokenId);
    const prefix = `${PRIVATE_TOKEN_PREFIX}${tokenId}_`;
    expect(tokenPlaintext.startsWith(prefix)).toBe(true);
    const secret = tokenPlaintext.slice(prefix.length);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(createHash('sha256').update(tokenPlaintext).digest('hex'));
  });

  it('produces unique plaintext per call', () => {
    const a = createPrivateTokenValue(crypto.randomUUID());
    const b = createPrivateTokenValue(crypto.randomUUID());
    expect(a.tokenPlaintext).not.toBe(b.tokenPlaintext);
    expect(a.digest).not.toBe(b.digest);
  });

  it('PRIVATE_TOKEN_SCOPES is a frozen fixed allowlist', () => {
    expect(Object.isFrozen(PRIVATE_TOKEN_SCOPES)).toBe(true);
    expect([...PRIVATE_TOKEN_SCOPES].sort()).toEqual(['releases.write', 'source_maps.upload']);
  });

  it('verifyTokenScope accepts only allowlisted scopes', () => {
    expect(verifyTokenScope(['source_maps.upload'])).toBe(true);
    expect(verifyTokenScope(['releases.write'])).toBe(true);
    expect(verifyTokenScope(['source_maps.upload', 'releases.write'])).toBe(true);
    expect(verifyTokenScope([])).toBe(false);
    expect(verifyTokenScope(['unknown'])).toBe(false);
    expect(verifyTokenScope(['source_maps.upload', 'unknown'])).toBe(false);
  });

  it('isPrivateTokenScope narrows allowlisted values', () => {
    expect(isPrivateTokenScope('source_maps.upload')).toBe(true);
    expect(isPrivateTokenScope('releases.write')).toBe(true);
    expect(isPrivateTokenScope('unknown')).toBe(false);
  });

  it('isExpired treats null expiry as never-expiring and past expiry as expired', () => {
    expect(isExpired({ expiresAt: null, revokedAt: null })).toBe(false);
    expect(
      isExpired({ expiresAt: new Date(Date.now() - 60_000).toISOString(), revokedAt: null }),
    ).toBe(true);
    expect(
      isExpired({ expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null }),
    ).toBe(false);
    expect(
      isExpired({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        revokedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it('getTokenStatus returns active/expired/revoked with revoked precedence', () => {
    expect(getTokenStatus({ expiresAt: null, revokedAt: null })).toBe('active');
    expect(getTokenStatus({ expiresAt: null, revokedAt: new Date().toISOString() })).toBe(
      'revoked',
    );
    expect(
      getTokenStatus({ expiresAt: new Date(Date.now() - 60_000).toISOString(), revokedAt: null }),
    ).toBe('expired');
    // Revoked wins over expired.
    expect(
      getTokenStatus({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        revokedAt: new Date().toISOString(),
      }),
    ).toBe('revoked');
  });
});
