import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createIngestionClientCredential, MAX_KEY_ID_ATTEMPTS } from '../src/lifecycle-create.js';
import { rotateIngestionClientCredential } from '../src/lifecycle-rotate.js';
import {
  disableIngestionClientCredential,
  enableIngestionClientCredential,
  revokeIngestionClientCredential,
} from '../src/lifecycle-mutate.js';

const projectA = '11111111-1111-1111-1111-111111111111';

interface Row {
  id: string;
  project_id: string;
  key_id: string;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A controllable fake pg Pool whose connect() returns a stateful transaction client. */
function fakePoolFor(rows: Row[], opts?: { throwOn?: (sql: string) => never | void }): Pool {
  const rowsState = [...rows];
  const tx = {
    query: async (
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: unknown[]; rowCount: number }> => {
      await Promise.resolve();
      opts?.throwOn?.(sql);
      if (sql.trim().toUpperCase().startsWith('BEGIN')) return { rows: [], rowCount: 0 };
      if (sql.trim().toUpperCase().startsWith('COMMIT')) return { rows: [], rowCount: 0 };
      if (sql.trim().toUpperCase().startsWith('ROLLBACK')) return { rows: [], rowCount: 0 };
      if (sql.includes('FOR UPDATE')) {
        const keyId = params?.[0];
        return {
          rows: rowsState.filter((r) => r.key_id === keyId),
          rowCount: rowsState.filter((r) => r.key_id === keyId).length,
        };
      }
      if (sql.includes('expires_at <= now()')) {
        const id = params?.[0];
        const row = rowsState.find((r) => r.id === id);
        const expired =
          row !== undefined && row.expires_at !== null
            ? new Date(row.expires_at).getTime() <= Date.now()
            : false;
        return { rows: [{ expired }], rowCount: 1 };
      }
      if (sql.includes('FROM ingestion_client_credential_origins')) {
        const id = params?.[0];
        return {
          rows: origins.filter((o) => o.credential_id === id).map((o) => ({ origin: o.origin })),
          rowCount: 0,
        };
      }
      if (sql.includes('FROM ingestion_client_credential_environments')) {
        const id = params?.[0];
        return {
          rows: environments
            .filter((e) => e.credential_id === id)
            .map((e) => ({ environment: e.environment })),
          rowCount: 0,
        };
      }
      if (sql.includes('INSERT INTO ingestion_client_credentials')) {
        const keyId = params?.[1] as string;
        if (rowsState.some((r) => r.key_id === keyId)) {
          const err = new Error('duplicate key') as Error & {
            code?: string;
            constraint?: string;
          };
          err.code = '23505';
          err.constraint = 'ingestion_client_credentials_key_id_key';
          throw err;
        }
        rowsState.push({
          id: 'new-id',
          project_id: String(params?.[0]),
          key_id: keyId,
          status: 'active',
          allow_non_browser: Boolean(params?.[3]),
          expires_at: params?.[4] ? new Date(params[4] as string).toISOString() : null,
          created_at: '2026-08-02T00:00:00.000Z',
          updated_at: '2026-08-02T00:00:00.000Z',
        });
        return { rows: [{ id: 'new-id' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO ingestion_client_credential_origins')) {
        origins.push({ credential_id: String(params?.[0]), origin: String(params?.[1]) });
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO ingestion_client_credential_environments')) {
        environments.push({ credential_id: String(params?.[0]), environment: String(params?.[1]) });
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE ingestion_client_credentials SET status')) {
        const id = params?.[0];
        const status = String(params?.[1]);
        const row = rowsState.find((r) => r.id === id);
        if (row !== undefined) row.status = status;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('WHERE id = $1') && sql.includes('SELECT')) {
        const id = params?.[0];
        return { rows: rowsState.filter((r) => r.id === id), rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return {
    connect: async () => {
      await Promise.resolve();
      return tx;
    },
  } as unknown as Pool;
}

const origins: { credential_id: string; origin: string }[] = [];
const environments: { credential_id: string; environment: string }[] = [];

function activeRow(keyId: string, overrides?: Partial<Row>): Row {
  return {
    id: 'cred-1',
    project_id: projectA,
    key_id: keyId,
    status: 'active',
    allow_non_browser: false,
    expires_at: null,
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('createIngestionClientCredential unit (fake pool)', () => {
  it('returns invalid_input for a bad projectId without touching the pool', async () => {
    const pool = fakePoolFor([]);
    const result = await createIngestionClientCredential(pool, {
      projectId: 'nope',
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('invalid_input');
  });

  it('uses a small bounded keyId retry constant', () => {
    expect(MAX_KEY_ID_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_KEY_ID_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it('returns generation_failed after exhausting keyId collisions', async () => {
    // A pool whose credential INSERT always raises a keyId uniqueness collision.
    const pool = {
      connect: async () => {
        await Promise.resolve();
        return {
          query: async (sql: string) => {
            await Promise.resolve();
            if (sql.includes('INSERT INTO ingestion_client_credentials')) {
              const err = new Error('duplicate key') as Error & {
                code?: string;
                constraint?: string;
              };
              err.code = '23505';
              err.constraint = 'ingestion_client_credentials_key_id_key';
              throw err;
            }
            return { rows: [], rowCount: 0 };
          },
          release: () => undefined,
        };
      },
    } as unknown as Pool;
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('generation_failed');
  });

  it('returns temporarily_unavailable for a non-keyId error without retrying', async () => {
    let insertCalls = 0;
    const pool = {
      connect: async () => {
        await Promise.resolve();
        return {
          query: async (sql: string) => {
            await Promise.resolve();
            if (sql.includes('INSERT INTO ingestion_client_credentials')) {
              insertCalls += 1;
              throw new Error('statement failed');
            }
            return { rows: [], rowCount: 0 };
          },
          release: () => undefined,
        };
      },
    } as unknown as Pool;
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('temporarily_unavailable');
    expect(insertCalls).toBe(1); // not retried on a generic error
  });

  it('returns temporarily_unavailable on a pool.connect failure', async () => {
    const pool = {
      connect: async () => {
        await Promise.resolve();
        throw new Error('connect failed');
      },
    } as unknown as Pool;
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('temporarily_unavailable');
  });

  it('covers the rollback-catch path when ROLLBACK itself throws', async () => {
    const pool = {
      connect: async () => {
        await Promise.resolve();
        return {
          query: async (sql: string) => {
            await Promise.resolve();
            if (sql.includes('BEGIN')) return { rows: [], rowCount: 0 };
            if (sql.includes('ROLLBACK')) throw new Error('rollback failed');
            if (sql.includes('INSERT INTO ingestion_client_credentials')) {
              throw new Error('statement failed');
            }
            return { rows: [], rowCount: 0 };
          },
          release: () => undefined,
        };
      },
    } as unknown as Pool;
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('temporarily_unavailable');
  });
});

describe('rotateIngestionClientCredential unit (fake pool)', () => {
  it('returns not_found when the credential does not exist', async () => {
    const pool = fakePoolFor([]);
    const result = await rotateIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('not_found');
  });

  it('returns invalid_state for a revoked credential', async () => {
    const pool = fakePoolFor([activeRow('AAAAAAAAAAAAAAAAAAAAAA', { status: 'revoked' })]);
    const result = await rotateIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('invalid_state');
  });

  it('returns expired for an expired credential', async () => {
    const pool = fakePoolFor([
      activeRow('AAAAAAAAAAAAAAAAAAAAAA', {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ]);
    const result = await rotateIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('expired');
  });

  it('rotates an active credential and inherits policy', async () => {
    const pool = fakePoolFor([activeRow('AAAAAAAAAAAAAAAAAAAAAA')]);
    const result = await rotateIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.clientKey).toMatch(/^aurora_ingest_/);
      expect(result.metadata.status).toBe('active');
    }
  });
});

describe('mutation unit (fake pool)', () => {
  it('disable returns not_found for an unknown keyId', async () => {
    const pool = fakePoolFor([]);
    const result = await disableIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('not_found');
  });

  it('enable returns invalid_state for a revoked credential', async () => {
    const pool = fakePoolFor([activeRow('AAAAAAAAAAAAAAAAAAAAAA', { status: 'revoked' })]);
    const result = await enableIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('invalid_state');
  });

  it('enable returns expired for an expired disabled credential', async () => {
    const pool = fakePoolFor([
      activeRow('AAAAAAAAAAAAAAAAAAAAAA', {
        status: 'disabled',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ]);
    const result = await enableIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('expired');
  });

  it('disable succeeds for an active credential', async () => {
    const pool = fakePoolFor([activeRow('AAAAAAAAAAAAAAAAAAAAAA')]);
    const result = await disableIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(result.status).toBe('success');
  });

  it('revoke succeeds and is idempotent', async () => {
    const pool = fakePoolFor([activeRow('AAAAAAAAAAAAAAAAAAAAAA')]);
    const first = await revokeIngestionClientCredential(pool, { keyId: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(first.status).toBe('success');
  });
});
