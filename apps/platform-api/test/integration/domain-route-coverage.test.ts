import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import type { SessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { buildPlatformApi } from '../../src/app.js';
import { loadPlatformApiConfig } from '../../src/config.js';
import {
  assertIsTestDatabase,
  createTestPool,
  runAllMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';
import { registerActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface ProjectBody {
  projectId: string;
  resourceVersion?: string;
}

interface ResponseBody {
  data?: Record<string, unknown>;
}

function createMemorySessionStore(prefix: string): SessionStore {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const client = {
    get: (key: string): Promise<string | null> => Promise.resolve(values.get(key) ?? null),
    set: (key: string, value: string): Promise<string> => {
      values.set(key, value);
      return Promise.resolve('OK');
    },
    sAdd: (key: string, value: string): Promise<number> => {
      const entries = sets.get(key) ?? new Set<string>();
      const before = entries.size;
      entries.add(value);
      sets.set(key, entries);
      return Promise.resolve(entries.size - before);
    },
    quit: (): Promise<string> => Promise.resolve('OK'),
  };
  return { client: client as unknown as SessionStore['client'], keyPrefix: prefix };
}

describeDb('platform domain route coverage (real PostgreSQL 17)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let owner: RegisteredActor;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    const sessionStore = createMemorySessionStore(`test:domain-route-coverage:${randomUUID()}`);
    app = buildPlatformApi({
      config: loadPlatformApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: 'redis://127.0.0.1:6379',
        SESSION_IDLE_MS: String(30 * 60 * 1000),
        SESSION_ABSOLUTE_MS: String(8 * 60 * 60 * 1000),
        COOKIE_SECURE: 'false',
        EMAIL_DELIVERY_MODE: 'console',
        APP_ORIGIN: '',
        LOG_ENABLED: 'false',
      }),
      pool,
      sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date('2026-09-22T00:00:00.000Z'),
    });
    owner = await registerActor(app, `domain-owner-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createProject(actor = owner, name = `Domain ${randomUUID()}`): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${actor.organizationId}/projects`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'x-aurora-csrf': actor.csrf,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ name, frameworkType: 'javascript', idempotencyKey: randomUUID() }),
    });
    expect(response.statusCode).toBe(200);
    return response.json<ProjectBody>().projectId;
  }

  function headers(actor: RegisteredActor): Record<string, string> {
    return {
      cookie: `aurora_session=${actor.cookie}`,
      'x-aurora-csrf': actor.csrf,
      'content-type': 'application/json',
    };
  }

  async function request(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    actor: RegisteredActor,
    body?: unknown,
  ) {
    return app.inject({
      method,
      url,
      headers: headers(actor),
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  }

  it('covers access, credentials, settings, lifecycle, source maps, and usage contracts', async () => {
    const projectId = await createProject();
    const projectPath = `/api/platform/v1/organizations/${owner.organizationId}/projects/${projectId}`;

    const settings = await request('GET', `${projectPath}/settings`, owner);
    expect(settings.statusCode).toBe(200);
    const settingsBody = settings.json<ResponseBody>();
    const initialVersion = String(
      (settingsBody.data?.project as { resourceVersion?: string }).resourceVersion,
    );

    const environments = await request('GET', `${projectPath}/settings/environments`, owner);
    expect(environments.statusCode, environments.body).toBe(200);
    const createdEnvironment = await request(
      'POST',
      `${projectPath}/settings/environments`,
      owner,
      { name: 'staging', idempotencyKey: randomUUID() },
    );
    expect(createdEnvironment.statusCode).toBe(200);
    const updated = await request('PATCH', `${projectPath}/settings`, owner, {
      name: 'Domain Updated',
      websiteUrl: 'https://domain.example.com',
      resourceVersion: initialVersion,
      idempotencyKey: randomUUID(),
    });
    expect(updated.statusCode).toBe(200);

    const access = await request('GET', `${projectPath}/access`, owner);
    expect(access.statusCode, access.body).toBe(200);
    const member = await registerActor(app, `domain-member-${randomUUID()}@example.com`);
    expect(
      (
        await insertOrganizationMembership(pool, {
          organizationId: owner.organizationId,
          accountId: member.accountId,
          role: 'member',
        })
      ).status,
    ).toBe('success');
    const granted = await request('POST', `${projectPath}/access/members`, owner, {
      accountId: member.accountId,
      role: 'developer',
      idempotencyKey: randomUUID(),
    });
    expect(granted.statusCode).toBe(200);
    const changed = await request(
      'POST',
      `${projectPath}/access/members/${member.accountId}/role`,
      owner,
      { role: 'read_only', idempotencyKey: randomUUID() },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    const removed = await request(
      'POST',
      `${projectPath}/access/members/${member.accountId}/remove`,
      owner,
      { idempotencyKey: randomUUID() },
    );
    expect(removed.statusCode).toBe(200);

    const keys = await request('GET', `${projectPath}/client-keys`, owner);
    expect(keys.statusCode).toBe(200);
    const newKey = await request('POST', `${projectPath}/client-keys`, owner, {
      origins: ['https://domain.example.com'],
      environments: ['production'],
      allowNonBrowser: false,
      idempotencyKey: randomUUID(),
    });
    expect(newKey.statusCode).toBe(200);
    const newKeyData = newKey.json<ResponseBody>().data as { keyId: string };
    const keyPath = `${projectPath}/client-keys/${newKeyData.keyId}`;
    expect(
      (await request('POST', `${keyPath}/disable`, owner, { idempotencyKey: randomUUID() }))
        .statusCode,
    ).toBe(200);
    expect(
      (await request('POST', `${keyPath}/enable`, owner, { idempotencyKey: randomUUID() }))
        .statusCode,
    ).toBe(200);
    expect(
      (await request('POST', `${keyPath}/revoke`, owner, { idempotencyKey: randomUUID() }))
        .statusCode,
    ).toBe(200);

    const releasesBefore = await request('GET', `${projectPath}/releases`, owner);
    expect(releasesBefore.statusCode).toBe(200);
    const digest = 'a'.repeat(64);
    const uploaded = await request('POST', `${projectPath}/source-maps`, owner, {
      releaseVersion: '2026.09.22',
      buildPath: 'assets/app.js.map',
      content: '{}',
      digest,
      idempotencyKey: randomUUID(),
    });
    expect(uploaded.statusCode).toBe(200);
    const uploadedData = uploaded.json<ResponseBody>().data as {
      releaseId: string;
      sourceMapFileId: string;
      version?: number;
    };
    const releases = await request('GET', `${projectPath}/releases`, owner);
    expect(releases.statusCode).toBe(200);
    const files = await request(
      'GET',
      `${projectPath}/releases/${uploadedData.releaseId}/source-maps`,
      owner,
    );
    expect(files.statusCode, files.body).toBe(200);
    const reparsed = await request(
      'POST',
      `${projectPath}/releases/${uploadedData.releaseId}/reparse`,
      owner,
      { idempotencyKey: randomUUID() },
    );
    expect(reparsed.statusCode).toBe(200);
    const replaced = await request(
      'POST',
      `${projectPath}/releases/${uploadedData.releaseId}/source-maps/${uploadedData.sourceMapFileId}/replace`,
      owner,
      {
        content: '{"version":3}',
        digest: 'b'.repeat(64),
        version: uploadedData.version ?? 1,
        idempotencyKey: randomUUID(),
      },
    );
    expect(replaced.statusCode).toBe(200);

    const usage = await request(
      'GET',
      `/api/platform/v1/organizations/${owner.organizationId}/usage`,
      owner,
    );
    expect(usage.statusCode).toBe(200);

    const lifecycleProject = await createProject();
    const lifecyclePath = `/api/platform/v1/organizations/${owner.organizationId}/projects/${lifecycleProject}`;
    expect(
      (
        await request('POST', `${lifecyclePath}/lifecycle/archive`, owner, {
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request('POST', `${lifecyclePath}/lifecycle/restore`, owner, {
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);

    const trashProject = await createProject();
    const trashPath = `/api/platform/v1/organizations/${owner.organizationId}/projects/${trashProject}`;
    const trashSettings = await request('GET', `${trashPath}/settings`, owner);
    const trashVersion = String(
      (trashSettings.json<ResponseBody>().data?.project as { resourceVersion?: string })
        .resourceVersion,
    );
    const trashed = await request('POST', `${trashPath}/lifecycle/move-to-trash`, owner, {
      resourceVersion: trashVersion,
      idempotencyKey: randomUUID(),
    });
    expect(trashed.statusCode).toBe(200);
  });

  it('rejects malformed command bodies across project domain routes', async () => {
    const projectId = await createProject();
    const projectPath = `/api/platform/v1/organizations/${owner.organizationId}/projects/${projectId}`;
    const accountId = randomUUID();
    const keyId = randomUUID();
    const issueId = '1';
    const noteId = '1';
    const invitationId = 'not-a-uuid';
    const tokenId = randomUUID();
    const notificationId = randomUUID();
    const malformedCommands: readonly {
      method: 'PATCH' | 'POST';
      url: string;
      body?: unknown;
    }[] = [
      { method: 'PATCH', url: `${projectPath}/settings` },
      { method: 'POST', url: `${projectPath}/settings/environments` },
      { method: 'POST', url: `${projectPath}/access/members` },
      { method: 'POST', url: `${projectPath}/access/members/${accountId}/role` },
      { method: 'POST', url: `${projectPath}/access/members/${accountId}/remove` },
      { method: 'POST', url: `${projectPath}/client-keys` },
      { method: 'POST', url: `${projectPath}/client-keys/${keyId}/disable` },
      { method: 'POST', url: `${projectPath}/client-keys/${keyId}/enable` },
      { method: 'POST', url: `${projectPath}/client-keys/${keyId}/revoke` },
      { method: 'POST', url: `${projectPath}/lifecycle/archive` },
      { method: 'POST', url: `${projectPath}/lifecycle/restore` },
      { method: 'POST', url: `${projectPath}/lifecycle/move-to-trash` },
      { method: 'POST', url: `${projectPath}/source-maps` },
      { method: 'POST', url: `${projectPath}/releases/1/reparse` },
      { method: 'POST', url: `${projectPath}/releases/1/source-maps/1/replace` },
      // Issue lifecycle commands must reject malformed bodies at the public
      // contract boundary before authorization or database access.
      { method: 'POST', url: `${projectPath}/issues/${issueId}/state` },
      { method: 'POST', url: `${projectPath}/issues/${issueId}/assignee` },
      { method: 'POST', url: `${projectPath}/issues/${issueId}/priority` },
      { method: 'POST', url: `${projectPath}/issues/${issueId}/notes` },
      { method: 'POST', url: `${projectPath}/issues/${issueId}/notes/${noteId}/delete` },
      { method: 'POST', url: `${projectPath}/issues/${issueId}/merge` },
      { method: 'POST', url: `${projectPath}/issues/batch` },
      {
        method: 'PATCH',
        url: `/api/platform/v1/organizations/${owner.organizationId}/settings/timezone`,
      },
      { method: 'POST', url: `/api/platform/v1/organizations/${owner.organizationId}/ownership` },
      { method: 'POST', url: `/api/platform/v1/organizations/${owner.organizationId}/invitations` },
      {
        method: 'POST',
        url: `/api/platform/v1/organizations/${owner.organizationId}/invitations/${invitationId}/revoke`,
      },
      {
        method: 'POST',
        url: `/api/platform/v1/organizations/${owner.organizationId}/invitations/${invitationId}/resend`,
      },
      {
        method: 'POST',
        url: `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`,
      },
      {
        method: 'POST',
        url: `/api/platform/v1/organizations/${owner.organizationId}/private-tokens/${tokenId}/revoke`,
      },
      {
        method: 'POST',
        url: `/api/platform/v1/organizations/${owner.organizationId}/trash/${projectId}/restore`,
      },
      { method: 'POST', url: `/api/platform/v1/notifications/${notificationId}/read` },
      { method: 'POST', url: '/api/platform/v1/platform-admin/admins/' + accountId + '/grant' },
      { method: 'POST', url: '/api/platform/v1/platform-admin/admins/' + accountId + '/revoke' },
      { method: 'POST', url: '/api/platform/v1/platform-admin/policy/default' },
      {
        method: 'POST',
        url: `/api/platform/v1/platform-admin/policy/organizations/${owner.organizationId}`,
      },
      {
        method: 'POST',
        url: `/api/platform/v1/platform-admin/policy/organizations/${owner.organizationId}/reset`,
      },
      { method: 'POST', url: `/api/platform/v1/platform-admin/policy/projects/${projectId}/limit` },
      {
        method: 'POST',
        url: `/api/platform/v1/platform-admin/policy/projects/${projectId}/limit/clear`,
      },
    ];

    for (const command of malformedCommands) {
      const response = await request(command.method, command.url, owner, command.body ?? {});
      expect(response.statusCode, `${command.method} ${command.url}`).toBe(400);
    }
  });

  it('covers stable validation and conflict responses for existing project commands', async () => {
    const projectId = await createProject();
    const projectPath = `/api/platform/v1/organizations/${owner.organizationId}/projects/${projectId}`;
    const settings = await request('GET', `${projectPath}/settings`, owner);
    const resourceVersion = String(
      (settings.json<ResponseBody>().data?.project as { resourceVersion?: string }).resourceVersion,
    );

    const stale = await request('PATCH', `${projectPath}/settings`, owner, {
      name: 'Stale update',
      resourceVersion: new Date(Date.parse(resourceVersion) - 1000).toISOString(),
      idempotencyKey: randomUUID(),
    });
    expect(stale.statusCode).toBe(412);

    const invalidRole = await request(
      'POST',
      `${projectPath}/access/members/${owner.accountId}/role`,
      owner,
      { role: 'invalid', idempotencyKey: randomUUID() },
    );
    expect(invalidRole.statusCode).toBe(400);

    const invalidOrigins = await request('POST', `${projectPath}/client-keys`, owner, {
      origins: ['not-a-url'],
      environments: ['production'],
      allowNonBrowser: false,
      idempotencyKey: randomUUID(),
    });
    expect(invalidOrigins.statusCode).toBe(422);

    const archived = await request('POST', `${projectPath}/lifecycle/archive`, owner, {
      idempotencyKey: randomUUID(),
    });
    expect(archived.statusCode).toBe(200);
    const restore = await request('POST', `${projectPath}/lifecycle/restore`, owner, {
      idempotencyKey: randomUUID(),
    });
    expect(restore.statusCode).toBe(200);
    const secondRestore = await request('POST', `${projectPath}/lifecycle/restore`, owner, {
      idempotencyKey: randomUUID(),
    });
    expect(secondRestore.statusCode).toBe(409);
  });
});
