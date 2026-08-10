import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';

const identityMigrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-identity/migrations', import.meta.url),
);
const organizationMigrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-organization/migrations', import.meta.url),
);
const projectGovernanceMigrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-project-governance/migrations', import.meta.url),
);
const credentialsMigrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-credentials/migrations', import.meta.url),
);
const auditMigrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-audit/migrations', import.meta.url),
);
const processingStoreMigrationsDir = fileURLToPath(
  new URL('../../../../packages/processing-store/migrations', import.meta.url),
);
export function testDatabaseUrl(): string {
  const url = process.env.AURORA_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set for integration tests');
  }
  return url;
}

/** Verify the target database is the dedicated Aurora test database. */
export function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

export function redisUrl(): string {
  const url = process.env.AURORA_TEST_REDIS_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_REDIS_URL must be set for integration tests');
  }
  return url;
}

export function createTestPool(): Pool {
  const url = testDatabaseUrl();
  assertIsTestDatabase(url);
  return new Pool({ connectionString: url });
}

/**
 * Run one migration directory up (idempotent, shared pgmigrations table).
 * `checkOrder: false` disables node-pg-migrate's cross-directory ordering
 * assertion: each platform package owns its own migration directory but they
 * all share the single `pgmigrations` table, so a later directory would
 * otherwise be rejected as "preceding" an already-applied migration (same
 * pattern as every platform package's run-migrations.ts).
 */
async function runMigrations(dir: string): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    checkOrder: false,
    log: () => undefined,
  });
}

/**
 * Run all PLT-03 identity migrations plus the four PLT-04 data-package
 * migrations (organization, project-governance, credentials, audit) AND the
 * @aurora/processing-store migrations (request metric buckets / event samples /
 * performance stores) so the full PLT-03/04 table set exists. Order is fixed:
 * identity first (base tables), then the packages that extend them (timestamp
 * order). Idempotent.
 */
export async function runAllMigrations(): Promise<void> {
  await runMigrations(identityMigrationsDir);
  await runMigrations(organizationMigrationsDir);
  await runMigrations(projectGovernanceMigrationsDir);
  await runMigrations(credentialsMigrationsDir);
  await runMigrations(auditMigrationsDir);
  await runMigrations(processingStoreMigrationsDir);
}

/**
 * Backward-compatible alias used by the PLT-03 flow tests: runs the identity
 * migrations AND the PLT-04 extensions that build on them, so the full table set
 * (including the tables `truncateIdentityTables` clears) exists. New tests
 * should call `runAllMigrations`.
 */
export async function runIdentityMigrations(): Promise<void> {
  await runAllMigrations();
}

/** Extract the `aurora_session` cookie value from a `set-cookie` header. */
export function extractSessionCookie(setCookie: unknown): string {
  const value = Array.isArray(setCookie)
    ? (setCookie as string[])[0]
    : (setCookie as string | undefined);
  if (typeof value !== 'string') {
    throw new Error('no set-cookie header in response');
  }
  const match = /^aurora_session=([^;]+)/.exec(value);
  if (match === null) {
    throw new Error('no aurora_session cookie in set-cookie header');
  }
  return match[1] ?? '';
}

/** Extract a named cookie value from a `set-cookie` header (first entry). */
export function extractCookie(setCookie: unknown, name: string): string | undefined {
  const value = Array.isArray(setCookie)
    ? (setCookie as string[])[0]
    : (setCookie as string | undefined);
  if (typeof value !== 'string') return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|; )${escaped}=([^;]+)`).exec(value);
  return match?.[1];
}

/** Extract the `aurora_intent` cookie value from a `set-cookie` header. */
export function extractIntentCookie(setCookie: unknown): string | undefined {
  return extractCookie(setCookie, 'aurora_intent');
}

/**
 * Extract the raw intent token from the most recent outbox row for an aggregate
 * type. The mailLinkUrl embeds the transient token as the final path segment.
 */
export async function outboxIntentToken(pool: Pool, aggregateType: string): Promise<string> {
  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM outbox WHERE aggregate_type = $1 ORDER BY created_at DESC, outbox_id DESC LIMIT 1`,
    [aggregateType],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`no outbox row for aggregate_type=${aggregateType}`);
  }
  const payload = row.payload as { mailLinkUrl?: unknown };
  const url = typeof payload.mailLinkUrl === 'string' ? payload.mailLinkUrl : '';
  // mailLinkUrl is an SPA confirm URL with the transient token as a query param:
  //   `${consoleOrigin}/verify-email/confirm?token=<token>`
  const tokenMatch = /\btoken=([^&]+)/.exec(url);
  const rawToken = tokenMatch === null ? undefined : tokenMatch[1];
  const token = rawToken === undefined ? undefined : decodeURIComponent(rawToken);
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`no token in outbox mailLinkUrl for aggregate_type=${aggregateType}`);
  }
  return token;
}

/**
 * Truncate all PLT-03 identity tables plus the PLT-04 tables and the SEC-01
 * deletion tables (test isolation). FK-safe order lists children first
 * (project_onboarding/project_environments/client_keys before projects;
 * deletion intents/handoffs before accounts); `CASCADE` also covers any FK edges
 * not listed.
 */
export async function truncateIdentityTables(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE outbox, idempotency_records, security_audit_events, project_members,
      project_onboarding, project_environments, client_keys, projects, private_tokens,
      organization_invitations, organization_members, organizations,
      account_cleanup_handoffs, account_deletion_intents,
      password_reset_intents, email_verification_intents,
      account_credentials, accounts CASCADE`,
  );
}
