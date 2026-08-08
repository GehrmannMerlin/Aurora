import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_REGISTER,
  identityRegisterRequest,
  identityRegisterResponse,
} from '../../src/identity/register.js';

describe('identityRegister contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_REGISTER).toBe('identityRegister');
  });

  it('accepts a valid register request', () => {
    const result = identityRegisterRequest.zod.safeParse({
      email: '  User@Example.COM ',
      password: 's3cure-Passw0rd!',
      idempotencyKey: 'k'.repeat(36),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = identityRegisterRequest.zod.safeParse({
      password: 'x'.repeat(12),
      idempotencyKey: 'k'.repeat(36),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an undeclared field (closed object)', () => {
    const result = identityRegisterRequest.zod.safeParse({
      email: 'a@b.co',
      password: 'x'.repeat(12),
      idempotencyKey: 'k'.repeat(36),
      evil: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid register response without secret material', () => {
    const result = identityRegisterResponse.zod.safeParse({
      accountId: 'acct_1',
      workspaceId: { organizationId: 'org_1' },
      emailMasked: 'u***@example.invalid',
      verificationStatus: { verified: false, reason: 'email_pending' },
      resendAvailableAt: '2026-08-09T01:00:00.000Z',
      serverTime: '2026-08-09T01:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a response leaking passwordHash/sessionId/token', () => {
    expect(
      identityRegisterResponse.zod.safeParse({
        accountId: 'acct_1',
        workspaceId: { organizationId: 'org_1' },
        emailMasked: 'u***@example.invalid',
        verificationStatus: { verified: false, reason: 'email_pending' },
        resendAvailableAt: '2026-08-09T01:00:00.000Z',
        serverTime: '2026-08-09T01:00:00.000Z',
        passwordHash: 'x',
        sessionId: 's_1',
        token: 't_1',
      }).success,
    ).toBe(false);
  });
});
