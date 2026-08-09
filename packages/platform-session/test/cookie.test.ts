import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from '../src/cookie.js';

describe('session cookie options', () => {
  it('returns HttpOnly SameSite=Lax host-only options with Secure enabled', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('disables Secure when the caller passes false', () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('never sets a Domain attribute (host-only cookie)', () => {
    const options = sessionCookieOptions(true);
    expect(Object.keys(options)).not.toContain('domain');
    expect('domain' in options).toBe(false);
  });
});
