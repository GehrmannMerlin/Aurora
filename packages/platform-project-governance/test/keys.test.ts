import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  createDefaultClientKey,
  generateClientKeySecret,
  randomPublicIdentifier,
  revokeClientKey,
  sha256Digest,
} from '../src/repositories/client-keys.js';
import { PlatformProjectGovernanceError } from '../src/errors.js';

/** Minimal fake PoolClient that returns a fixed row set from `query`. */
function fakeClient(rows: unknown[]): PoolClient {
  return {
    query: () => Promise.resolve({ rows }),
    release: () => Promise.resolve(),
  } as unknown as PoolClient;
}

describe('client key generation helpers', () => {
  it('generates a random 32-byte base64url secret', () => {
    const a = generateClientKeySecret();
    const b = generateClientKeySecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url = 43 chars, no padding
  });

  it('produces a stable hex SHA-256 digest of the secret', () => {
    const secret = 'hello-secret';
    const digest = sha256Digest(secret);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Digest(secret)).toBe(digest);
    expect(sha256Digest('other')).not.toBe(digest);
  });

  it('builds public identifiers with the aurora_key_ prefix and base64url(8)', () => {
    const id = randomPublicIdentifier();
    expect(id.startsWith('aurora_key_')).toBe(true);
    expect(id.slice('aurora_key_'.length)).toMatch(/^[A-Za-z0-9_-]{11}$/); // base64url(8) = 11 chars
    expect(randomPublicIdentifier()).not.toBe(id);
  });
});

describe('createDefaultClientKey (fake client)', () => {
  it('returns only the public identifier and never the digest', async () => {
    const client = fakeClient([{ client_key_id: 'ck_1' }]);
    const result = await createDefaultClientKey(client, { projectId: 'prj_1' });
    expect(result.clientKeyId).toBe('ck_1');
    expect(result.publicIdentifier.startsWith('aurora_key_')).toBe(true);
    expect(result).not.toHaveProperty('keyDigest');
    expect(result).not.toHaveProperty('secret');
  });

  it('fails closed with statement_failed when the insert returns no row', async () => {
    const client = fakeClient([]);
    await expect(createDefaultClientKey(client, { projectId: 'prj_1' })).rejects.toBeInstanceOf(
      PlatformProjectGovernanceError,
    );
    await expect(createDefaultClientKey(client, { projectId: 'prj_1' })).rejects.toMatchObject({
      kind: 'statement_failed',
    });
  });

  it('reports not_found when revoking a key that is not in the org/project scope', async () => {
    const client = fakeClient([]);
    const result = await revokeClientKey(client, {
      orgId: 'org_1',
      projectId: 'prj_1',
      clientKeyId: 'ck_missing',
      actorId: 'acc_1',
    });
    expect(result).toEqual({ status: 'not_found' });
  });
});
