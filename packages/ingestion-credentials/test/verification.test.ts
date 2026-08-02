import { createHash } from 'node:crypto';
import type { Pool, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { verifyIngestionCredential } from '../src/verification.js';

const VALID_KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const VALID_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface FakeRow {
  id: string;
  project_id: string;
  secret_digest: Buffer;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
}

/** Same digest derivation as the real code path (decoded 32-byte secret). */
function decodeBase64UrlUnpadded(value: string): Buffer {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64');
}

function digestOf(secret: string): Buffer {
  return createHash('sha256').update(decodeBase64UrlUnpadded(secret)).digest();
}

function queryResult(rows: unknown[]): QueryResult {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    fields: [],
    oid: 0,
  };
}

interface FakeCredential {
  keyId: string;
  secret: string;
  status?: string;
  allowNonBrowser?: boolean;
  expiresAt?: Date | null;
  origins?: string[];
  environments?: string[];
}

function fakePoolFor(credential?: FakeCredential): { pool: Pool; calls: string[] } {
  const calls: string[] = [];
  const row: FakeRow | undefined =
    credential === undefined
      ? undefined
      : {
          id: 'cred-id',
          project_id: '11111111-1111-1111-1111-111111111111',
          secret_digest: digestOf(credential.secret),
          status: credential.status ?? 'active',
          allow_non_browser: credential.allowNonBrowser ?? false,
          expires_at:
            credential.expiresAt === undefined || credential.expiresAt === null
              ? null
              : credential.expiresAt.toISOString(),
        };
  const pool = {
    query: async (sql: string): Promise<QueryResult> => {
      calls.push(sql);
      await Promise.resolve();
      if (sql.includes('WHERE key_id = $1')) {
        return queryResult(row === undefined ? [] : [row]);
      }
      if (sql.includes('expires_at <= now()')) {
        return queryResult([{ expired: false }]);
      }
      if (sql.includes('FROM ingestion_client_credential_environments')) {
        const environments = credential?.environments ?? [];
        return queryResult(environments.map((environment) => ({ environment })));
      }
      if (sql.includes('FROM ingestion_client_credential_origins')) {
        const origins = credential?.origins ?? [];
        return queryResult(origins.map((origin) => ({ origin })));
      }
      return queryResult([]);
    },
  } as unknown as Pool;
  return { pool, calls };
}

const validInput = {
  clientKey: `aurora_ingest_${VALID_KEY_ID}_${VALID_SECRET}`,
  environment: 'production',
  origin: 'https://a.example.com',
};

describe('verifyIngestionCredential (unit, fake pool)', () => {
  it('authorizes a valid active credential', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      origins: ['https://a.example.com'],
      environments: ['production'],
    });
    const result = await verifyIngestionCredential(pool, validInput);
    expect(result.status).toBe('authorized');
  });

  it('returns unauthenticated for an unknown keyId', async () => {
    const { pool } = fakePoolFor();
    const result = await verifyIngestionCredential(pool, validInput);
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for a wrong secret', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      origins: ['https://a.example.com'],
      environments: ['production'],
    });
    const otherSecret = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const result = await verifyIngestionCredential(pool, {
      ...validInput,
      clientKey: `aurora_ingest_${VALID_KEY_ID}_${otherSecret}`,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for disabled or revoked credentials', async () => {
    for (const status of ['disabled', 'revoked']) {
      const { pool } = fakePoolFor({
        keyId: VALID_KEY_ID,
        secret: VALID_SECRET,
        status,
        origins: ['https://a.example.com'],
        environments: ['production'],
      });
      const result = await verifyIngestionCredential(pool, validInput);
      expect(result.status).toBe('unauthenticated');
    }
  });

  it('returns origin_forbidden when the origin is not allowed', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      origins: ['https://a.example.com'],
      environments: ['production'],
    });
    const result = await verifyIngestionCredential(pool, {
      ...validInput,
      origin: 'https://evil.example.com',
    });
    expect(result.status).toBe('origin_forbidden');
  });

  it('returns origin_forbidden for missing origin when non-browser is disallowed', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      allowNonBrowser: false,
      origins: ['https://a.example.com'],
      environments: ['production'],
    });
    const result = await verifyIngestionCredential(pool, { ...validInput, origin: null });
    expect(result.status).toBe('origin_forbidden');
  });

  it('authorizes a missing origin when non-browser is allowed', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      allowNonBrowser: true,
      origins: ['https://a.example.com'],
      environments: ['production'],
    });
    const result = await verifyIngestionCredential(pool, { ...validInput, origin: null });
    expect(result.status).toBe('authorized');
  });

  it('returns environment_forbidden when the environment is not allowed', async () => {
    const { pool } = fakePoolFor({
      keyId: VALID_KEY_ID,
      secret: VALID_SECRET,
      origins: ['https://a.example.com'],
      environments: ['staging'],
    });
    const result = await verifyIngestionCredential(pool, {
      ...validInput,
      environment: 'production',
    });
    expect(result.status).toBe('environment_forbidden');
  });

  it('returns unauthenticated for a malformed key', async () => {
    const { pool } = fakePoolFor();
    const result = await verifyIngestionCredential(pool, {
      ...validInput,
      clientKey: 'not-a-valid-key',
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns temporarily_unavailable on a database query error', async () => {
    const pool = {
      query: async () => {
        await Promise.resolve();
        throw new Error('db down');
      },
    } as unknown as Pool;
    const result = await verifyIngestionCredential(pool, validInput);
    expect(result.status).toBe('temporarily_unavailable');
  });
});
