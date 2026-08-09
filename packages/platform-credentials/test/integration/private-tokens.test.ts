import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRIVATE_TOKEN_PREFIX,
  PRIVATE_TOKEN_SCOPES,
  createPrivateToken,
  getTokenStatus,
  isExpired,
  listPrivateTokens,
  revokePrivateToken,
  verifyTokenScope,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRow,
  queryRows,
  resetCredentialsSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-credentials private-tokens repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetCredentialsSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOrg(): Promise<{ orgId: string; ownerId: string }> {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    return { orgId, ownerId };
  }

  it('creates a token, returns one-time plaintext, stores only the SHA-256 digest', async () => {
    const { orgId, ownerId } = await createOrg();
    const created = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'ci-token',
      scopes: ['source_maps.upload'],
    });

    expect(created.status).toBe('success');
    expect(created.tokenPlaintext.startsWith(`${PRIVATE_TOKEN_PREFIX}${created.tokenId}_`)).toBe(
      true,
    );
    // The secret portion is high-entropy base64url (32 bytes → 43 chars).
    const secret = created.tokenPlaintext.slice(
      `${PRIVATE_TOKEN_PREFIX}${created.tokenId}_`.length,
    );
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.digest).toBe(createHash('sha256').update(created.tokenPlaintext).digest('hex'));

    // The database stores only the digest — never the plaintext.
    const rows = await queryRows<Record<string, unknown>>(
      pool,
      `SELECT * FROM private_tokens WHERE token_id = $1`,
      [created.tokenId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('token row missing');
    expect(row.token_digest).toBe(created.digest);
    for (const [column, value] of Object.entries(row)) {
      const text = String(value);
      expect(text, `plaintext leaked into column ${column}`).not.toBe(created.tokenPlaintext);
      expect(text, `plaintext leaked into column ${column}`).not.toContain(created.tokenPlaintext);
    }

    // No plaintext column exists in the schema at all.
    const columns = await queryRows<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'private_tokens'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('token_plaintext');
    expect(names).not.toContain('plaintext');
    expect(names).toContain('token_digest');
  });

  it('list returns metadata only — no digest, no plaintext', async () => {
    const { orgId, ownerId } = await createOrg();
    const created = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'ci-token',
      scopes: ['releases.write'],
    });

    const listed = await listPrivateTokens(pool, orgId);
    expect(listed.length).toBeGreaterThanOrEqual(1);
    const token = listed.find((t) => t.tokenId === created.tokenId);
    expect(token).toBeDefined();
    expect(token?.name).toBe('ci-token');
    expect(token?.scopes).toEqual(['releases.write']);
    expect(token?.expiresAt).toBeNull();
    expect(token?.revokedAt).toBeNull();
    expect(token?.lastUsedAt).toBeNull();
    expect(token?.createdAt).toBeDefined();
    expect(token?.organizationId).toBe(orgId);

    for (const entry of listed) {
      const record = entry as unknown as Record<string, unknown>;
      expect(Object.keys(record)).not.toContain('tokenDigest');
      expect(Object.keys(record)).not.toContain('digest');
      expect(Object.keys(record)).not.toContain('tokenPlaintext');
      expect(Object.keys(record)).not.toContain('plaintext');
    }
  });

  it('revoke is irreversible and audited in-transaction; re-revoke is idempotent without audit noise', async () => {
    const { orgId, ownerId } = await createOrg();
    const created = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'ci-token',
      scopes: ['source_maps.upload'],
    });

    const before = await queryRows<{ event_id: string }>(
      pool,
      `SELECT event_id FROM security_audit_events WHERE organization_id = $1`,
      [orgId],
    );

    const revoked = await revokePrivateToken(pool, { tokenId: created.tokenId, actorId: ownerId });
    expect(revoked.status).toBe('success');

    const row = await queryRow<{ revoked_at: string | null; expires_at: string | null }>(
      pool,
      `SELECT revoked_at, expires_at FROM private_tokens WHERE token_id = $1`,
      [created.tokenId],
    );
    expect(row?.revoked_at).not.toBeNull();
    const status = getTokenStatus({
      expiresAt: row?.expires_at ?? null,
      revokedAt: row?.revoked_at ?? null,
    });
    expect(status).toBe('revoked');

    const after = await queryRows<{ event_id: string; action: string; details: unknown }>(
      pool,
      `SELECT event_id, action, details FROM security_audit_events WHERE organization_id = $1 ORDER BY occurred_at, event_id`,
      [orgId],
    );
    expect(after.length).toBe(before.length + 1);
    const revokeAudit = after.find((a) => a.action === 'credentials.private_token.revoked');
    expect(revokeAudit).toBeDefined();
    expect(JSON.stringify(revokeAudit?.details)).not.toContain(created.tokenPlaintext);
    expect(JSON.stringify(revokeAudit?.details)).not.toContain(created.digest);

    // Re-revoke: still success, no duplicate audit noise.
    const revokeAgain = await revokePrivateToken(pool, {
      tokenId: created.tokenId,
      actorId: ownerId,
    });
    expect(revokeAgain.status).toBe('success');
    const afterRevokeAgain = await queryRows<{ event_id: string }>(
      pool,
      `SELECT event_id FROM security_audit_events WHERE organization_id = $1`,
      [orgId],
    );
    expect(afterRevokeAgain.length).toBe(after.length);
  });

  it('revoking a non-existent token returns not_found', async () => {
    const { orgId, ownerId } = await createOrg();
    const result = await revokePrivateToken(pool, {
      tokenId: crypto.randomUUID(),
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
    void orgId;
  });

  it('create writes an audit event whose details contain no secret material', async () => {
    const { orgId, ownerId } = await createOrg();
    const created = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'audited-token',
      scopes: ['source_maps.upload', 'releases.write'],
    });

    const audit = await queryRows<{ action: string; details: unknown }>(
      pool,
      `SELECT action, details FROM security_audit_events
       WHERE organization_id = $1 AND action = 'credentials.private_token.created'`,
      [orgId],
    );
    expect(audit.length).toBe(1);
    const detailsText = JSON.stringify(audit[0]?.details);
    expect(detailsText).not.toContain(created.tokenPlaintext);
    expect(detailsText).not.toContain(created.digest);
    expect(detailsText).not.toContain(PRIVATE_TOKEN_PREFIX);
    expect(detailsText).toContain(created.tokenId);
  });

  it('expires_at is enforced: past expiry is rejected, null never expires, elapsed expiry is expired', async () => {
    const { orgId, ownerId } = await createOrg();

    // A past expiresAt is rejected at create time as invalid input.
    await expect(
      createPrivateToken(pool, {
        orgId,
        createdBy: ownerId,
        name: 'expired-create',
        scopes: ['source_maps.upload'],
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });

    // expiresAt: null never expires.
    const never = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'never-expires',
      scopes: ['source_maps.upload'],
      expiresAt: null,
    });
    expect(never.expiresAt).toBeNull();
    expect(isExpired({ expiresAt: null, revokedAt: null })).toBe(false);

    // A future expiry is active until it elapses; once elapsed it is expired.
    const future = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'will-expire',
      scopes: ['source_maps.upload'],
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    expect(future.expiresAt).not.toBeNull();
    expect(isExpired({ expiresAt: future.expiresAt, revokedAt: null })).toBe(false);
    expect(getTokenStatus({ expiresAt: future.expiresAt, revokedAt: null })).toBe('active');

    // Force the expiry into the past (as if time elapsed) and re-check.
    await pool.query(
      `UPDATE private_tokens SET expires_at = now() - interval '1 day' WHERE token_id = $1`,
      [future.tokenId],
    );
    const listed = await listPrivateTokens(pool, orgId);
    const elapsed = listed.find((t) => t.tokenId === future.tokenId);
    expect(elapsed).toBeDefined();
    expect(isExpired({ expiresAt: elapsed?.expiresAt ?? null, revokedAt: null })).toBe(true);
    expect(getTokenStatus({ expiresAt: elapsed?.expiresAt ?? null, revokedAt: null })).toBe(
      'expired',
    );
  });

  it('scope allowlist: valid scopes succeed, unknown or empty scopes are rejected as invalid_input', async () => {
    const { orgId, ownerId } = await createOrg();

    const ok = await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'scoped',
      scopes: [...PRIVATE_TOKEN_SCOPES],
    });
    expect(ok.status).toBe('success');
    expect(ok.scopes).toEqual([...PRIVATE_TOKEN_SCOPES]);

    await expect(
      createPrivateToken(pool, {
        orgId,
        createdBy: ownerId,
        name: 'bad-scope',
        scopes: ['not_a_real_scope'],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });

    await expect(
      createPrivateToken(pool, {
        orgId,
        createdBy: ownerId,
        name: 'empty-scope',
        scopes: [],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });

    expect(verifyTokenScope(['source_maps.upload'])).toBe(true);
    expect(verifyTokenScope(['source_maps.upload', 'releases.write'])).toBe(true);
    expect(verifyTokenScope(['unknown'])).toBe(false);
    expect(verifyTokenScope([])).toBe(false);
  });

  it('rejects a blank token name as invalid_input', async () => {
    const { orgId, ownerId } = await createOrg();
    await expect(
      createPrivateToken(pool, {
        orgId,
        createdBy: ownerId,
        name: '   ',
        scopes: ['source_maps.upload'],
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('scopes an org: tokens of one org are not listed in another', async () => {
    const { orgId, ownerId } = await createOrg();
    const otherOwner = await createTestAccount(pool, `other-${crypto.randomUUID()}@example.com`);
    const otherOrgId = await createTestOrganization(pool, 'Other', otherOwner);

    await createPrivateToken(pool, {
      orgId,
      createdBy: ownerId,
      name: 'org-a-token',
      scopes: ['source_maps.upload'],
    });
    await createPrivateToken(pool, {
      orgId: otherOrgId,
      createdBy: otherOwner,
      name: 'org-b-token',
      scopes: ['releases.write'],
    });

    const orgAList = await listPrivateTokens(pool, orgId);
    expect(orgAList.map((t) => t.name)).toEqual(['org-a-token']);
    expect(orgAList.every((t) => t.organizationId === orgId)).toBe(true);
  });
});
