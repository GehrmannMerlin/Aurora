#!/usr/bin/env node
/**
 * OPS-05 dry-run CLI. Never talks to AWS: it reads release manifests and
 * migration dirs and prints the deployment / rollback / migration-validation
 * plan. Real provisioning is executed by the CI deploy pipeline (deploy/aws)
 * only after provisioning credentials exist (PROVISIONING_EVIDENCE_PENDING).
 *
 *   aurora-release plan \
 *     --manifest <manifest.json> [--previous <prev.json>] \
 *     --targets services=ingestion-api,ingestion-worker;spa;migrate \
 *     [--migration-dirs packages/ingestion-inbox/migrations,...]
 *   aurora-release validate-migrations --migration-dirs <dir1>,<dir2>
 *
 * Exit 0 = plan valid, 1 = validation failed.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildReleaseManifest, type ReleaseManifest } from './manifest.js';
import {
  discoverMigrationSet,
  renderForwardMigrationCommand,
  validateForwardCompatibility,
} from './migrations.js';
import { assertSafeDeployment, planDeployment } from './deploy.js';
import { assertNoDestructiveMigrationRollback, planRollback } from './rollback.js';

interface CliOptions {
  readonly command: 'plan' | 'validate-migrations' | 'plan-rollback';
  readonly manifestPath: string | undefined;
  readonly previousPath: string | undefined;
  readonly services: readonly string[];
  readonly spa: boolean;
  readonly migrate: boolean;
  readonly migrationDirs: readonly string[];
  readonly databaseUrlEnv: string;
}

const DATABASE_URL_ENV_DEFAULT = 'DATABASE_URL';

function parseArgs(argv: readonly string[]): CliOptions {
  const command = argv[0] as CliOptions['command'] | undefined;
  if (command !== 'plan' && command !== 'validate-migrations' && command !== 'plan-rollback') {
    throw new Error(
      'release_cli_invalid_command: expected plan, validate-migrations or plan-rollback',
    );
  }
  let manifestPath: string | undefined;
  let previousPath: string | undefined;
  const services: string[] = [];
  let spa = false;
  let migrate = false;
  const migrationDirs: string[] = [];
  let databaseUrlEnv = DATABASE_URL_ENV_DEFAULT;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--manifest' && next !== undefined) {
      manifestPath = next;
      i += 1;
    } else if (arg === '--previous' && next !== undefined) {
      previousPath = next;
      i += 1;
    } else if (arg === '--targets' && next !== undefined) {
      for (const token of next.split(';')) {
        if (token === 'spa') {
          spa = true;
        } else if (token === 'migrate') {
          migrate = true;
        } else if (token.startsWith('services=')) {
          services.push(
            ...token
              .slice('services='.length)
              .split(',')
              .filter((s) => s.length > 0),
          );
        } else {
          throw new Error(`release_cli_invalid_target: unknown target token ${token}`);
        }
      }
      i += 1;
    } else if (arg === '--migration-dirs' && next !== undefined) {
      migrationDirs.push(...next.split(',').filter((d) => d.length > 0));
      i += 1;
    } else if (arg === '--db-env' && next !== undefined) {
      databaseUrlEnv = next;
      i += 1;
    } else {
      throw new Error(`release_cli_invalid_arg: ${String(arg)}`);
    }
  }
  return {
    command,
    manifestPath,
    previousPath,
    services,
    spa,
    migrate,
    migrationDirs,
    databaseUrlEnv,
  };
}

async function loadManifest(path: string | undefined): Promise<ReleaseManifest | undefined> {
  if (path === undefined) return undefined;
  const text = await readFile(path, 'utf8');
  return buildReleaseManifest(JSON.parse(text));
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);

  if (options.command === 'validate-migrations') {
    if (options.migrationDirs.length === 0) {
      throw new Error(
        'release_cli_migration_dirs_required: validate-migrations needs --migration-dirs',
      );
    }
    const migrations = await discoverMigrationSet(options.migrationDirs);
    const violations = validateForwardCompatibility(migrations);
    if (violations.length > 0) {
      process.stdout.write(`forward-compatibility violations: ${violations.join(', ')}\n`);
      return 1;
    }
    process.stdout.write(
      `forward-compatible: ${String(migrations.length)} migrations across ${String(options.migrationDirs.length)} dirs\n`,
    );
    return 0;
  }

  // plan-rollback
  if (options.command === 'plan-rollback') {
    const manifest = await loadManifest(options.manifestPath);
    const previous = await loadManifest(options.previousPath);
    if (manifest === undefined || previous === undefined) {
      throw new Error(
        'release_cli_manifest_required: plan-rollback needs --manifest and --previous',
      );
    }
    const plan = planRollback(manifest, previous);
    assertNoDestructiveMigrationRollback(plan);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }

  // plan
  const manifest = await loadManifest(options.manifestPath);
  if (manifest === undefined) {
    throw new Error('release_cli_manifest_required: plan needs --manifest');
  }
  const previous = await loadManifest(options.previousPath);
  const migrationCommands =
    options.migrate && options.migrationDirs.length > 0
      ? renderForwardMigrationCommand(
          await discoverMigrationSet(options.migrationDirs),
          options.databaseUrlEnv,
        )
      : [];
  const steps = planDeployment(
    manifest,
    previous,
    { services: options.services, spa: options.spa, migrate: options.migrate },
    migrationCommands,
  );
  assertSafeDeployment(steps);
  process.stdout.write(`${JSON.stringify({ commitSha: manifest.commitSha, steps }, null, 2)}\n`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
