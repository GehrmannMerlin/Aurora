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

const validPayload = {
  intentType: 'email_verification',
  toAddress: 'user@example.com',
  toMasked: 'u***@example.com',
  mailLinkUrl: 'https://aurora.ah.cn/verify?token=transient-token',
  expiresInMinutes: 120,
} as const;

function row(overrides: Partial<Omit<OutboxRow, 'payload'>> & { payload?: unknown }): OutboxRow {
  return {
    outboxId: 'row-1',
    aggregateType: 'email.verification',
    aggregateId: null,
    status: 'processing',
    attemptCount: 0,
    availableAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload: validPayload,
    ...overrides,
  };
}

function repoWith(claimResult: ClaimOutboxRowsResult): {
  repo: OutboxRepository;
  markOutboxResult: ReturnType<typeof vi.fn>;
} {
  const markOutboxResult = vi.fn<OutboxRepository['markOutboxResult']>();
  markOutboxResult.mockResolvedValue({ status: 'success' });
  const claimOutboxRows = vi.fn<OutboxRepository['claimOutboxRows']>();
  claimOutboxRows.mockResolvedValue(claimResult);
  return {
    markOutboxResult,
    repo: {
      insertOutboxRow: vi.fn<OutboxRepository['insertOutboxRow']>(),
      claimOutboxRows,
      markOutboxResult,
    },
  };
}

describe('consumeOutboxEmails', () => {
  it('returns zero counts when there is nothing to claim', async () => {
    const { repo, markOutboxResult } = repoWith({ status: 'nothingToClaim' });
    const port: EmailDeliveryPort = { deliver: vi.fn() };

    const result = await consumeOutboxEmails({ pool, port, outboxRepo: repo, now: new Date() });

    expect(result).toEqual({ consumed: 0, failed: 0 });
    expect(markOutboxResult).not.toHaveBeenCalled();
    expect(port.deliver).not.toHaveBeenCalled();
  });

  it('settles a claimed row as succeeded when the port enqueues', async () => {
    const { repo, markOutboxResult } = repoWith({ status: 'claimed', rows: [row({})] });
    const deliver = vi.fn().mockResolvedValue({ status: 'enqueued' });

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver },
      outboxRepo: repo,
      now: new Date(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 1, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({
      intentType: 'email_verification',
      toAddress: 'user@example.com',
      toAddressMasked: 'u***@example.com',
      mailLinkUrl: 'https://aurora.ah.cn/verify?token=transient-token',
      expiresInMinutes: 120,
    });
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      status: 'succeeded',
      attemptCount: 1,
    });
  });

  it('maps the masked payload field into the port request (toMasked → toAddressMasked)', async () => {
    const { repo } = repoWith({ status: 'claimed', rows: [row({})] });
    const deliver = vi.fn().mockResolvedValue({ status: 'enqueued' });

    await consumeOutboxEmails({ pool, port: { deliver }, outboxRepo: repo, now: new Date() });

    const request = deliver.mock.calls[0]?.[0] as {
      toAddress?: string;
      toAddressMasked?: string;
      toMasked?: string;
    };
    expect(request?.toAddressMasked).toBe('u***@example.com');
    expect(request?.toAddress).toBe('user@example.com');
    expect(request?.toMasked).toBeUndefined();
  });

  it('increments attempt_count and marks failed below the budget', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ attemptCount: 1 })],
    });
    const deliver = vi.fn().mockResolvedValue({ status: 'failed', reason: 'provider_down' });

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver },
      outboxRepo: repo,
      now: new Date(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      status: 'failed',
      attemptCount: 2,
    });
  });

  it('dead-letters when the attempt budget is exhausted', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ attemptCount: 2 })],
    });
    const deliver = vi.fn().mockResolvedValue({ status: 'failed', reason: 'provider_down' });

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver },
      outboxRepo: repo,
      now: new Date(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      status: 'dead_lettered',
      attemptCount: 3,
    });
  });

  it('dead-letters a non-object payload without calling the port', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ payload: 'not-an-object' })],
    });
    const deliver = vi.fn();

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver },
      outboxRepo: repo,
      now: new Date(),
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    expect(deliver).not.toHaveBeenCalled();
    expect(markOutboxResult).toHaveBeenCalledWith(pool, {
      outboxId: 'row-1',
      status: 'dead_lettered',
      attemptCount: 1,
    });
  });

  const invalidPayloadCases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    [
      'intentType',
      { toAddress: 'a@b.co', toMasked: 'a***', mailLinkUrl: 'u', expiresInMinutes: 5 },
    ],
    [
      'toAddress',
      { intentType: 'email_verification', toMasked: 'a***', mailLinkUrl: 'u', expiresInMinutes: 5 },
    ],
    [
      'toMasked',
      {
        intentType: 'email_verification',
        toAddress: 'a@b.co',
        mailLinkUrl: 'u',
        expiresInMinutes: 5,
      },
    ],
    [
      'mailLinkUrl',
      {
        intentType: 'email_verification',
        toAddress: 'a@b.co',
        toMasked: 'a***',
        expiresInMinutes: 5,
      },
    ],
    [
      'expiresInMinutes',
      { intentType: 'email_verification', toAddress: 'a@b.co', toMasked: 'a***', mailLinkUrl: 'u' },
    ],
    [
      'expiresInMinutes (nan)',
      {
        intentType: 'email_verification',
        toAddress: 'a@b.co',
        toMasked: 'a***',
        mailLinkUrl: 'u',
        expiresInMinutes: Number.NaN,
      },
    ],
    [
      'expiresInMinutes (non-positive)',
      {
        intentType: 'email_verification',
        toAddress: 'a@b.co',
        toMasked: 'a***',
        mailLinkUrl: 'u',
        expiresInMinutes: 0,
      },
    ],
  ];

  it.each(invalidPayloadCases)(
    'dead-letters a payload with an invalid %s field',
    async (_field, payload) => {
      const { repo, markOutboxResult } = repoWith({
        status: 'claimed',
        rows: [row({ payload })],
      });
      const deliver = vi.fn();

      const result = await consumeOutboxEmails({
        pool,
        port: { deliver },
        outboxRepo: repo,
        now: new Date(),
      });

      expect(result).toEqual({ consumed: 0, failed: 1 });
      expect(deliver).not.toHaveBeenCalled();
      expect(markOutboxResult).toHaveBeenCalledWith(pool, {
        outboxId: 'row-1',
        status: 'dead_lettered',
        attemptCount: 1,
      });
    },
  );

  it('tallies mixed outcomes across a batch', async () => {
    const { repo, markOutboxResult } = repoWith({
      status: 'claimed',
      rows: [row({ outboxId: 'a', attemptCount: 0 }), row({ outboxId: 'b', attemptCount: 2 })],
    });
    const deliver = vi
      .fn()
      .mockResolvedValueOnce({ status: 'enqueued' })
      .mockResolvedValueOnce({ status: 'failed', reason: 'nope' });

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver },
      outboxRepo: repo,
      now: new Date(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 1, failed: 1 });
    expect(markOutboxResult).toHaveBeenNthCalledWith(1, pool, {
      outboxId: 'a',
      status: 'succeeded',
      attemptCount: 1,
    });
    expect(markOutboxResult).toHaveBeenNthCalledWith(2, pool, {
      outboxId: 'b',
      status: 'dead_lettered',
      attemptCount: 3,
    });
  });
});
