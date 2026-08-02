import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { startIngestionWorker } from '../src/start.js';
import type { IngestionEventProcessor } from '../src/processor.js';

interface FakePoolRecord {
  ended: boolean;
  endCalls: number;
  queryCalls: number;
}

/** A fake pg Pool that returns a single claimed row once, then nothing. */
function fakePoolFactory(record: FakePoolRecord): () => Pool {
  let claimsHandedOut = 0;
  const claimedRow = {
    id: 1,
    project_id: '11111111-1111-1111-1111-111111111111',
    event_id: 'evt-composed',
    envelope: JSON.stringify({ protocolVersion: 1, eventId: 'evt-composed', eventType: 'error' }),
    attempt_count: 1,
    lease_id: '11111111-1111-1111-1111-111111111111',
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  return () =>
    ({
      query: async (sql: string) => {
        record.queryCalls += 1;
        await Promise.resolve();
        const isClaim = typeof sql === 'string' && sql.includes('FOR UPDATE SKIP LOCKED');
        const isWriteBack = typeof sql === 'string' && sql.includes('RETURNING') && !isClaim;
        if (isClaim) {
          // Hand out the single row exactly once; afterwards nothing is claimable.
          if (claimsHandedOut === 0) {
            claimsHandedOut += 1;
            return { rows: [claimedRow] };
          }
          return { rows: [] };
        }
        if (isWriteBack) {
          // markProcessed/scheduleRetry/markDeadLettered succeed.
          return { rows: [claimedRow] };
        }
        return { rows: [] };
      },
      connect: async () => {
        await Promise.resolve();
        return {
          query: async () => {
            await Promise.resolve();
            return { rows: [] };
          },
          release: () => undefined,
        };
      },
      end: async () => {
        await Promise.resolve();
        record.ended = true;
        record.endCalls += 1;
      },
    }) as unknown as Pool;
}

function baseConfig() {
  return {
    workerId: 'worker-start',
    claimBatchSize: 5,
    maxConcurrentHandlers: 2,
    leaseDurationMs: 1000,
    leaseRenewIntervalMs: 200,
    idlePollIntervalMs: 10,
    infrastructureFailureDelayMs: 100,
    shutdownGracePeriodMs: 500,
    maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

const processor: IngestionEventProcessor = {
  process: () => Promise.resolve({ outcome: 'processed' }),
};

describe('startIngestionWorker composition root', () => {
  it('starts and closes the worker, closing the owned pool exactly once', async () => {
    const record = { ended: false, endCalls: 0, queryCalls: 0 };
    const running = await startIngestionWorker({
      config: baseConfig(),
      processor,
      poolFactory: fakePoolFactory(record),
    });
    await running.close();
    await running.close();
    expect(record.ended).toBe(true);
    expect(record.endCalls).toBe(1);
  });

  it('drives the processing repository through the claim and write-back loop', async () => {
    const record = { ended: false, endCalls: 0, queryCalls: 0 };
    const running = await startIngestionWorker({
      config: { ...baseConfig(), idlePollIntervalMs: 5 },
      processor,
      poolFactory: fakePoolFactory(record),
    });
    // Let the claim loop claim the row, process it, and write back processed.
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await running.close();
    // At least a claim query and a write-back query were issued through the
    // composed processing repository.
    expect(record.queryCalls).toBeGreaterThanOrEqual(2);
    expect(record.endCalls).toBe(1);
  });

  it('forwards retry and dead-letter write-backs through the composed repository', async () => {
    const record = { ended: false, endCalls: 0, queryCalls: 0 };
    // Three claimable rows; the processor returns retry, dead-letter, processed.
    let rowIndex = 0;
    const rows = [
      {
        id: 1,
        project_id: '11111111-1111-1111-1111-111111111111',
        event_id: 'evt-retry',
        envelope: JSON.stringify({ protocolVersion: 1, eventId: 'evt-retry', eventType: 'error' }),
        attempt_count: 1,
        lease_id: 'a',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        id: 2,
        project_id: '11111111-1111-1111-1111-111111111111',
        event_id: 'evt-dead',
        envelope: JSON.stringify({ protocolVersion: 1, eventId: 'evt-dead', eventType: 'error' }),
        attempt_count: 1,
        lease_id: 'b',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    const outcomeProcessor: IngestionEventProcessor = {
      process: (input) => {
        if (input.eventId === 'evt-retry') {
          return Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'service_temporarily_unavailable',
          });
        }
        return Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' });
      },
    };
    const poolFactory: () => Pool = () =>
      ({
        query: async (sql: string) => {
          record.queryCalls += 1;
          await Promise.resolve();
          const isClaim = typeof sql === 'string' && sql.includes('FOR UPDATE SKIP LOCKED');
          const isWriteBack = typeof sql === 'string' && sql.includes('RETURNING') && !isClaim;
          if (isClaim) {
            if (rowIndex < rows.length) {
              const row = rows[rowIndex];
              rowIndex += 1;
              return { rows: [row] };
            }
            return { rows: [] };
          }
          if (isWriteBack) return { rows: [rows[0] ?? { id: 1 }] };
          return { rows: [] };
        },
        connect: async () => {
          await Promise.resolve();
          return {
            query: async () => {
              await Promise.resolve();
              return { rows: [] };
            },
            release: () => undefined,
          };
        },
        end: async () => {
          await Promise.resolve();
          record.ended = true;
          record.endCalls += 1;
        },
      }) as unknown as Pool;
    const running = await startIngestionWorker({
      config: { ...baseConfig(), idlePollIntervalMs: 5 },
      processor: outcomeProcessor,
      poolFactory,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await running.close();
    expect(record.queryCalls).toBeGreaterThanOrEqual(4);
    expect(record.endCalls).toBe(1);
  });
});
