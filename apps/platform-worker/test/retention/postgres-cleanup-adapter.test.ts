import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PostgresCleanupAdapter } from '../../src/retention/postgres-cleanup-adapter.js';
import { AuditCleanupAdapter } from '../../src/retention/audit-cleanup-adapter.js';

const INPUT = {
  accountId: '00000000-0000-0000-0000-000000000001',
  accountEmail: 'leaver@example.com',
  requiredLifecycle: { backupExpiryDays: 35 },
};

interface MockClient {
  readonly executed: readonly string[];
  query(sql: string, params?: readonly unknown[]): Promise<{ rowCount: number }>;
  release(): void;
}

function makeClient(failOn?: (sql: string) => boolean): MockClient {
  const executed: string[] = [];
  return {
    executed,
    query: (sql) => {
      if (failOn?.(sql)) return Promise.reject(new Error('boom'));
      executed.push(sql);
      return Promise.resolve({ rowCount: 1 });
    },
    release: () => undefined,
  };
}

function makePool(client: MockClient): Pool {
  return {
    connect: () => Promise.resolve(client),
    query: (sql: string, params?: readonly unknown[]) => client.query(sql, params),
  } as unknown as Pool;
}

describe('PostgresCleanupAdapter', () => {
  it('issues the ordered cleanup SQL: credentials, intents, memberships, invitations, audit, account shell', async () => {
    const client = makeClient();
    const adapter = new PostgresCleanupAdapter(makePool(client));
    const result = await adapter.cleanup(INPUT);
    expect(result).toEqual({ ok: true });
    const sql = client.executed.join('\n');
    expect(sql).toContain('DELETE FROM account_credentials WHERE account_id = $1');
    expect(sql).toContain('DELETE FROM email_verification_intents WHERE account_id = $1');
    expect(sql).toContain('DELETE FROM password_reset_intents WHERE account_id = $1');
    expect(sql).toContain('DELETE FROM account_deletion_intents WHERE account_id = $1');
    expect(sql).toContain('DELETE FROM organization_members WHERE account_id = $1');
    expect(sql).toContain('DELETE FROM project_members WHERE account_id = $1');
    expect(sql).toContain("status = 'revoked'");
    expect(sql).toContain('UPDATE security_audit_events SET actor_account_id = NULL');
    expect(sql).toContain("email = 'deleted:'");
    expect(sql).toContain("status = 'terminated'");
    expect(sql).toContain('COMMIT');
  });

  it('returns a stable failure result and rolls back when a step throws', async () => {
    const client = makeClient((sql) => sql.startsWith('DELETE FROM organization_members'));
    const adapter = new PostgresCleanupAdapter(makePool(client));
    const result = await adapter.cleanup(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toContain('postgres_cleanup_failed');
    expect(client.executed.some((sql) => sql === 'ROLLBACK')).toBe(true);
  });
});

describe('AuditCleanupAdapter', () => {
  it('writes a cleanup_completed security audit event without direct identity', async () => {
    const client = makeClient();
    const adapter = new AuditCleanupAdapter(makePool(client));
    const result = await adapter.cleanup(INPUT);
    expect(result).toEqual({ ok: true });
    const sql = client.executed.join('\n');
    expect(sql).toContain('cleanup_completed');
    expect(sql).not.toContain(INPUT.accountEmail);
  });

  it('returns a stable failure result when the audit insert throws', async () => {
    const client = makeClient(() => true);
    const adapter = new AuditCleanupAdapter(makePool(client));
    const result = await adapter.cleanup(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toContain('audit_cleanup_failed');
  });
});
