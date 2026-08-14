import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { EmailDeliveryPort } from '../src/email-delivery-port.js';
import {
  consumeOutboxEmails,
  type ClaimOutboxRowsResult,
  type OutboxRepository,
  type OutboxRow,
} from '../src/outbox-consumer.js';

const pool = {} as Pool;
const NOW = new Date('2026-08-14T00:00:00.000Z');
const EXPIRES_AT = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString();

const validPayload = {
  intentType: 'email_verification',
  toAddress: 'user@example.invalid',
  toMasked: 'u***@example.invalid',
  mailLinkUrl: 'https://console.example.invalid/verify?token=transient-token',
  expiresInMinutes: 120,
  intentExpiresAt: EXPIRES_AT,
} as const;

function row(
  overrides: Partial<Omit<OutboxRow, 'payload'>> & { payload?: unknown } = {},
): OutboxRow {
  return {
    outboxId: 'row-1',
    aggregateType: 'email.verification',
    aggregateId: null,
    status: 'processing',
    attemptCount: 1,
    claimId: 'claim-1',
    lastErrorCode: null,
    providerRequestId: null,
    availableAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    payload: validPayload,
    ...overrides,
  };
}

function repoWith(
  claimResult: ClaimOutboxRowsResult,
  settlement: 'success' | 'stale_claim' = 'success',
) {
  const claimOutboxRows = vi.fn<OutboxRepository['claimOutboxRows']>();
  claimOutboxRows.mockResolvedValue(claimResult);
  const markOutboxResult = vi.fn<OutboxRepository['markOutboxResult']>();
  markOutboxResult.mockResolvedValue({ status: settlement });
  return {
    claimOutboxRows,
    markOutboxResult,
    repo: {
      insertOutboxRow: vi.fn<OutboxRepository['insertOutboxRow']>(),
      claimOutboxRows,
      markOutboxResult,
    } satisfies OutboxRepository,
  };
}

function consumeInput(
  repo: OutboxRepository,
  port: EmailDeliveryPort,
): Parameters<typeof consumeOutboxEmails>[0] {
  return {
    pool,
    port,
    outboxRepo: repo,
    now: NOW,
    maxAttempts: 5,
    processingTimeoutMs: 5 * 60 * 1000,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 300_000,
    entropy01: () => 0,
  };
}

describe('consumeOutboxEmails', () => {
  it('passes processing timeout to claim and returns zero when nothing is available', async () => {
    const { repo, claimOutboxRows } = repoWith({ status: 'nothingToClaim' });
    const deliver = vi.fn();

    await expect(consumeOutboxEmails(consumeInput(repo, { deliver }))).resolves.toEqual({
      consumed: 0,
      failed: 0,
    });
    expect(claimOutboxRows).toHaveBeenCalledWith(pool, {
      limit: 20,
      now: NOW,
      processingTimeoutMs: 300_000,
      maxAttempts: 5,
    });
  });

  it('settles accepted delivery as succeeded, persists provider ID, and scrubs payload', async () => {
    const { repo, markOutboxResult } = repoWith({ status: 'claimed', rows: [row()] });
    const deliver = vi.fn().mockResolvedValue({
      status: 'accepted',
      providerRequestId: 'provider-request-1',
    });

    await expect(consumeOutboxEmails(consumeInput(repo, { deliver }))).resolves.toEqual({
      consumed: 1,
      failed: 0,
    });
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      claimId: 'claim-1',
      status: 'succeeded',
      attemptCount: 1,
      providerRequestId: 'provider-request-1',
      clearPayload: true,
    });
  });

  it('schedules retryable failure below budget and retains the payload', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ attemptCount: 1 })],
    });
    const deliver = vi.fn().mockResolvedValue({
      status: 'failed',
      retryable: true,
      reasonCode: 'EMAIL_PROVIDER_UNAVAILABLE',
    });

    await expect(consumeOutboxEmails(consumeInput(repo, { deliver }))).resolves.toEqual({
      consumed: 0,
      failed: 1,
    });
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      claimId: 'claim-1',
      status: 'failed',
      attemptCount: 1,
      availableAt: new Date(NOW.getTime() + 500),
      errorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      clearPayload: false,
    });
  });

  it('dead-letters and scrubs a retryable failure at attempt five', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ attemptCount: 5 })],
    });
    const deliver = vi.fn().mockResolvedValue({
      status: 'failed',
      retryable: true,
      reasonCode: 'EMAIL_PROVIDER_TIMEOUT',
    });

    await consumeOutboxEmails(consumeInput(repo, { deliver }));
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      claimId: 'claim-1',
      status: 'dead_lettered',
      attemptCount: 5,
      errorCode: 'EMAIL_PROVIDER_TIMEOUT',
      clearPayload: true,
    });
  });

  it('dead-letters and scrubs a permanent failure immediately', async () => {
    const { repo, markOutboxResult } = repoWith({ status: 'claimed', rows: [row()] });
    const deliver = vi.fn().mockResolvedValue({
      status: 'failed',
      retryable: false,
      reasonCode: 'EMAIL_INVALID_RECIPIENT',
    });

    await consumeOutboxEmails(consumeInput(repo, { deliver }));
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      claimId: 'claim-1',
      status: 'dead_lettered',
      attemptCount: 1,
      errorCode: 'EMAIL_INVALID_RECIPIENT',
      clearPayload: true,
    });
  });

  it.each([
    ['malformed', { broken: true }, 'EMAIL_PAYLOAD_INVALID'],
    [
      'expired',
      { ...validPayload, intentExpiresAt: new Date(NOW.getTime() - 1).toISOString() },
      'EMAIL_INTENT_EXPIRED',
    ],
    [
      'verification missing expiry',
      { ...validPayload, intentExpiresAt: undefined },
      'EMAIL_PAYLOAD_INVALID',
    ],
  ])('dead-letters %s payload before calling the provider', async (_label, payload, errorCode) => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ payload })],
    });
    const deliver = vi.fn();

    await consumeOutboxEmails(consumeInput(repo, { deliver }));
    expect(deliver).not.toHaveBeenCalled();
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      claimId: 'claim-1',
      status: 'dead_lettered',
      attemptCount: 1,
      errorCode,
      clearPayload: true,
    });
  });

  it('accepts a pre-migration non-verification payload without intentExpiresAt', async () => {
    const { repo } = repoWith({
      status: 'claimed',
      rows: [
        row({
          aggregateType: 'email.password_reset',
          payload: {
            ...validPayload,
            intentType: 'password_reset',
            intentExpiresAt: undefined,
          },
        }),
      ],
    });
    const deliver = vi.fn().mockResolvedValue({ status: 'accepted' });

    await consumeOutboxEmails(consumeInput(repo, { deliver }));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('normalizes a provider throw to a retryable stable failure without raw content', async () => {
    const { repo, markOutboxResult } = repoWith({ status: 'claimed', rows: [row()] });
    const deliver = vi.fn().mockRejectedValue(new Error('raw provider token and response'));

    await consumeOutboxEmails(consumeInput(repo, { deliver }));
    expect(markOutboxResult).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        errorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
        clearPayload: false,
      }),
    );
    expect(JSON.stringify(markOutboxResult.mock.calls)).not.toContain('raw provider');
  });

  it('does not count a stale-claim settlement as consumed or failed', async () => {
    const { repo } = repoWith({ status: 'claimed', rows: [row()] }, 'stale_claim');
    const deliver = vi.fn().mockResolvedValue({ status: 'accepted' });

    await expect(consumeOutboxEmails(consumeInput(repo, { deliver }))).resolves.toEqual({
      consumed: 0,
      failed: 0,
    });
  });

  it('starts every row in the bounded claimed batch before slow deliveries settle', async () => {
    const { repo } = repoWith({
      status: 'claimed',
      rows: [
        row({ outboxId: 'row-1', claimId: 'claim-1' }),
        row({ outboxId: 'row-2', claimId: 'claim-2' }),
      ],
    });
    let active = 0;
    let maxActive = 0;
    const deliver = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { status: 'accepted' as const };
    });

    await consumeOutboxEmails({ ...consumeInput(repo, { deliver }), limit: 2 });

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);
  });
});
