import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

async function runMigrations(direction: 'up' | 'down'): Promise<void> {
  const databaseUrl = process.env.AURORA_TEST_DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set to run migrations');
  }
  const executed = await runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });
  console.log(`migrations ${direction}: ${String(executed.length)} executed`);
}

const rawDirection = process.argv[2] as 'up' | 'down' | undefined;
const direction: 'up' | 'down' = rawDirection === 'down' ? 'down' : 'up';

runMigrations(direction)
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`migration failed: ${message}`);
    process.exitCode = 1;
  });
