import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_RESULT_DEFAULT, listAuditEvents, type AuditEventSummary } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  insertTestAuditEvent,
  resetAuditSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-audit security-audit read repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetAuditSchema(pool);
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

  it('returns redacted summaries: no full email or details leak, actor is masked', async () => {
    const { orgId } = await createOrg();
    const actorId = crypto.randomUUID();
    const email = 'boss@example.com';
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: actorId,
      action: 'member.invited',
      details: { email, note: 'contains secret material' },
    });

    const page = await listAuditEvents(pool, { orgId });
    expect(page.events.length).toBeGreaterThanOrEqual(1);
    const event = page.events[0];
    if (event === undefined) throw new Error('expected an audit event');
    expect(event.action).toBe('member.invited');
    // The redacted projection never exposes the details body or an email field.
    expect(JSON.stringify(event)).not.toContain(email);
    expect(JSON.stringify(event)).not.toContain('secret material');
    expect(Object.keys(event)).not.toContain('details');
    expect(Object.keys(event)).not.toContain('email');
    expect(Object.keys(event)).not.toContain('actorAccountId');
    // actorMasked is a masked projection, never the raw id and never an email.
    expect(event.actorMasked).not.toBe(actorId);
    expect(event.actorMasked).not.toContain('@');
    expect(event.actorMasked).toMatch(/^[0-9a-f]{8}…$/);
    expect(event.actorMasked.length).toBeGreaterThanOrEqual(3);
    expect(event.actorMasked.length).toBeLessThanOrEqual(320);
    expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('maps result correctly: succeeded/failed/blocked pass through, NULL → stable default', async () => {
    const { orgId } = await createOrg();
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.succeeded',
      result: 'succeeded',
    });
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.failed',
      result: 'failed',
    });
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.blocked',
      result: 'blocked',
    });
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.null',
    });

    const page = await listAuditEvents(pool, { orgId });
    const byAction = new Map(page.events.map((e) => [e.action, e.result]));
    expect(byAction.get('a.succeeded')).toBe('succeeded');
    expect(byAction.get('a.failed')).toBe('failed');
    expect(byAction.get('a.blocked')).toBe('blocked');
    expect(byAction.get('a.null')).toBe(AUDIT_RESULT_DEFAULT);
  });

  it('enforces the 1-year retention window by default and respects from/to', async () => {
    const { orgId } = await createOrg();
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.old',
      occurredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    });
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'a.recent',
      occurredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });

    const page = await listAuditEvents(pool, { orgId });
    const actions = page.events.map((e) => e.action);
    expect(actions).toContain('a.recent');
    expect(actions).not.toContain('a.old');

    // A from/to window filters out events outside the range.
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const windowed = await listAuditEvents(pool, { orgId, from, to });
    const windowedActions = windowed.events.map((e) => e.action);
    expect(windowedActions).not.toContain('a.old');
    expect(windowedActions).not.toContain('a.recent');
  });

  it('returns tombstone rows: a bare project_id uuid with no matching projects row still yields targetProjectRef', async () => {
    const { orgId } = await createOrg();
    const deletedProjectId = crypto.randomUUID();
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'project.permanently_deleted',
      projectId: deletedProjectId,
    });
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'member.removed',
    });

    const page = await listAuditEvents(pool, { orgId });
    const tomb = page.events.find((e) => e.action === 'project.permanently_deleted');
    expect(tomb).toBeDefined();
    expect(tomb?.targetProjectRef).toEqual({ projectId: deletedProjectId });
    const noProject = page.events.find((e) => e.action === 'member.removed');
    expect(noProject).toBeDefined();
    expect(noProject?.targetProjectRef).toBeUndefined();
    expect(Object.keys(noProject ?? {})).not.toContain('targetProjectRef');
  });

  it('pages with a cursor over events with no gaps or duplicates', async () => {
    const { orgId } = await createOrg();
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await insertTestAuditEvent(pool, {
        organizationId: orgId,
        actorAccountId: crypto.randomUUID(),
        action: `page.event.${String(i)}`,
        occurredAt: new Date(base - i * 1000),
      });
    }

    const collected: AuditEventSummary[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    for (;;) {
      const page = await listAuditEvents(
        pool,
        cursor === undefined ? { orgId, limit: 2 } : { orgId, cursor, limit: 2 },
      );
      collected.push(...page.events);
      pageCount += 1;
      const next = page.pagination.nextCursor;
      if (next === undefined) break;
      cursor = next;
    }

    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(collected.map((e) => e.action)).toEqual([
      'page.event.0',
      'page.event.1',
      'page.event.2',
      'page.event.3',
      'page.event.4',
    ]);
    const ids = collected.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scopes to the organization: only the requested org events are returned', async () => {
    const { orgId } = await createOrg();
    const otherOwner = await createTestAccount(pool, `other-${crypto.randomUUID()}@example.com`);
    const otherOrgId = await createTestOrganization(pool, 'Other', otherOwner);
    await insertTestAuditEvent(pool, {
      organizationId: orgId,
      actorAccountId: crypto.randomUUID(),
      action: 'org.a',
    });
    await insertTestAuditEvent(pool, {
      organizationId: otherOrgId,
      actorAccountId: crypto.randomUUID(),
      action: 'org.b',
    });

    const page = await listAuditEvents(pool, { orgId });
    expect(page.events.map((e) => e.action)).toEqual(['org.a']);
  });

  it('rejects an out-of-range limit as invalid_input', async () => {
    const { orgId } = await createOrg();
    await expect(listAuditEvents(pool, { orgId, limit: 0 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    await expect(listAuditEvents(pool, { orgId, limit: 101 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });

  it('rejects a malformed cursor as invalid_input', async () => {
    const { orgId } = await createOrg();
    await expect(listAuditEvents(pool, { orgId, cursor: 'not-a-cursor' })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });
});
