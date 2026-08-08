import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { replayDeadLettered } from '../src/replay.js';
import type { ReplayDeadLetteredEventResult } from '../src/replay-types.js';

/** A stub Pool whose connect would fail if validation let execution through. */
function rejectingPool(): Pool {
  return {
    connect: () => Promise.reject(new Error('unexpected connect for invalid input')),
  } as unknown as Pool;
}

describe('replayDeadLettered input validation', () => {
  const valid = {
    projectId: '11111111-1111-1111-1111-111111111111',
    inboxId: 1,
    operationId: 'op-00000000-0000-4000-8000-000000000001',
    requestedAt: new Date('2026-08-02T00:00:00.000Z'),
  };

  it('throws invalid_input for an empty projectId', async () => {
    await expect(replayDeadLettered(rejectingPool(), { ...valid, projectId: '' })).rejects.toMatchObject(
      { kind: 'invalid_input' },
    );
  });

  it('throws invalid_input for a non-positive or unsafe inboxId', async () => {
    await expect(
      replayDeadLettered(rejectingPool(), { ...valid, inboxId: 0 }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      replayDeadLettered(rejectingPool(), {
        ...valid,
        inboxId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('throws invalid_input for an empty operationId', async () => {
    await expect(
      replayDeadLettered(rejectingPool(), { ...valid, operationId: '' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('throws invalid_input for an invalid requestedAt', async () => {
    await expect(
      replayDeadLettered(rejectingPool(), { ...valid, requestedAt: new Date(Number.NaN) }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('does not mutate its input object', async () => {
    const input = { ...valid };
    const snapshot = { ...input, requestedAt: input.requestedAt.getTime() };
    await replayDeadLettered(rejectingPool(), input).catch(() => undefined);
    expect(input.projectId).toBe(snapshot.projectId);
    expect(input.inboxId).toBe(snapshot.inboxId);
    expect(input.operationId).toBe(snapshot.operationId);
    expect(input.requestedAt.getTime()).toBe(snapshot.requestedAt);
  });
});

describe('ReplayDeadLetteredEventResult shape', () => {
  it('supports the five discriminable statuses', () => {
    const statuses: ReplayDeadLetteredEventResult['status'][] = [
      'replayed',
      'already_replayed',
      'not_found',
      'invalid_state',
      'operation_conflict',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('is a plain union carrying no pg rows, SQLSTATE, or constraint fields', () => {
    const sample: ReplayDeadLetteredEventResult = {
      status: 'replayed',
      replayGeneration: 1,
      availableAt: new Date('2026-08-02T00:00:00.000Z'),
    };
    expect(Object.keys(sample).sort()).toEqual(['availableAt', 'replayGeneration', 'status']);
  });
});

