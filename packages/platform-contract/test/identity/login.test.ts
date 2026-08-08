import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LOGIN,
  OPERATION_ID_LOGOUT,
  identityLoginRequest,
  identityLoginResponse,
  identityLogoutResponse,
} from '../../src/identity/login.js';

describe('identityLogin contract', () => {
  it('has the frozen operation ids', () => {
    expect(OPERATION_ID_LOGIN).toBe('identityLogin');
    expect(OPERATION_ID_LOGOUT).toBe('identityLogout');
  });

  it('accepts a valid login request', () => {
    expect(
      identityLoginRequest.zod.safeParse({
        email: 'user@example.invalid',
        password: 's3cure-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects missing password', () => {
    expect(
      identityLoginRequest.zod.safeParse({
        email: 'user@example.invalid',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field (closed object)', () => {
    expect(
      identityLoginRequest.zod.safeParse({
        email: 'user@example.invalid',
        password: 'x'.repeat(12),
        idempotencyKey: 'k'.repeat(36),
        token: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid login response without secret material', () => {
    expect(
      identityLoginResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'user@example.invalid', verified: true },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-09T01:00:00.000Z' },
        csrf: 'csrf_token',
        navigation: {
          navigationTargets: { routeId: 'workspace.home', pathParams: {}, query: {} },
        },
        continuation: {
          target: { routeId: 'workspace.home', pathParams: {}, query: {} },
          kind: 'return_to',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a response leaking sessionId or password', () => {
    expect(
      identityLoginResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'user@example.invalid', verified: true },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-09T01:00:00.000Z', sessionId: 's_1' },
        csrf: 'csrf_token',
        navigation: {
          navigationTargets: { routeId: 'workspace.home', pathParams: {}, query: {} },
        },
        continuation: {
          target: { routeId: 'workspace.home', pathParams: {}, query: {} },
          kind: 'return_to',
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a valid logout response without secret material', () => {
    expect(
      identityLogoutResponse.zod.safeParse({
        status: 'succeeded',
        serverTime: '2026-08-09T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a logout response carrying a raw token', () => {
    expect(
      identityLogoutResponse.zod.safeParse({
        status: 'succeeded',
        serverTime: '2026-08-09T01:00:00.000Z',
        rawToken: 'x',
      }).success,
    ).toBe(false);
  });
});
