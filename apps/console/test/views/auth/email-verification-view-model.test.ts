import { describe, expect, it } from 'vitest';
import {
  deriveResendState,
  estimateServerNow,
} from '../../../src/views/auth/email-verification-view-model.js';

describe('email verification resend view model', () => {
  it('uses the server-time anchor instead of a skewed client clock', () => {
    const observedClientTime = new Date('2026-08-14T09:00:00.000Z');
    expect(
      estimateServerNow({
        serverTime: '2026-08-14T01:00:00.000Z',
        observedClientTime,
        clientNow: new Date('2026-08-14T09:00:05.000Z'),
      }).toISOString(),
    ).toBe('2026-08-14T01:00:05.000Z');
  });

  it('rounds cooldown seconds up and becomes ready without negative values', () => {
    expect(
      deriveResendState({
        serverTime: '2026-08-14T01:00:00.000Z',
        resendAvailableAt: '2026-08-14T01:00:01.001Z',
        clientNow: new Date('2026-08-14T09:00:00.000Z'),
      }),
    ).toEqual({ kind: 'cooldown', remainingSeconds: 2 });
    expect(
      deriveResendState({
        serverTime: '2026-08-14T01:00:02.000Z',
        resendAvailableAt: '2026-08-14T01:00:01.001Z',
        clientNow: new Date('2026-08-14T09:00:02.000Z'),
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('fails closed to ready when no resend timestamp exists', () => {
    expect(
      deriveResendState({
        serverTime: '2026-08-14T01:00:00.000Z',
        resendAvailableAt: null,
        clientNow: new Date('2026-08-14T09:00:00.000Z'),
      }),
    ).toEqual({ kind: 'ready' });
  });
});
