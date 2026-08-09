import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { insertAuditEvent } from '../src/repositories/audit.js';

function mockClient(record?: { params: unknown[] }): PoolClient {
  return {
    query: (_sql: string, params?: unknown[]) => {
      if (record !== undefined && params !== undefined) {
        record.params = params;
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as PoolClient;
}

describe('audit repository helper', () => {
  it('inserts a fully-populated audit event', async () => {
    let calls = 0;
    const client = {
      query: () => {
        calls += 1;
        return Promise.resolve({ rows: [] });
      },
    } as unknown as PoolClient;
    await insertAuditEvent(client, {
      organizationId: crypto.randomUUID(),
      actorAccountId: crypto.randomUUID(),
      action: 'organization.member.removed',
      targetAccountId: crypto.randomUUID(),
      details: { reason: 'reorg' },
    });
    expect(calls).toBe(1);
  });

  it('defaults absent ids and details to null and empty object', async () => {
    const record: { params: unknown[] } = { params: [] };
    await insertAuditEvent(mockClient(record), {
      action: 'organization.invitation.created',
    });
    expect(record.params[0]).toBeNull();
    expect(record.params[1]).toBeNull();
    expect(record.params[2]).toBe('organization.invitation.created');
    expect(record.params[3]).toBeNull();
    expect(record.params[4]).toEqual({});
  });
});
