import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemorySourceMapObjectStorage,
  createReparseTask,
  createSourceMapFile,
  replaceSourceMapFile,
  sourceMapObjectKey,
  upsertRelease,
  type SourceMapObjectStoragePort,
} from '@aurora/platform-releases';
import { persistErrorEventOccurrence } from '@aurora/processing-store';
import { runSourceMapReparseRound } from '../../src/source-maps/reparse-round.js';
import { assertIsTestDatabase, createTestPool, testDatabaseUrl } from './helpers.js';

const processingMigrations = fileURLToPath(
  new URL('../../../../packages/processing-store/migrations', import.meta.url),
);
const releasesMigrations = fileURLToPath(
  new URL('../../../../packages/platform-releases/migrations', import.meta.url),
);

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const BUILD_PATH = '/assets/app.js';

/** Tiny v3 map: generated line 1, col 100 → src/app.ts:1:0, name "render". */
const MAP_CONTENT = JSON.stringify({
  version: 3,
  sources: ['src/app.ts'],
  names: ['render'],
  mappings: 'AAAAA',
});

async function seedOccurrence(pool: Pool, projectId: string, stack: string): Promise<string> {
  const result = await persistErrorEventOccurrence(pool, {
    projectId,
    eventEnvelope: {
      protocolVersion: 1,
      eventId: `reparse-seed-${randomUUID()}`,
      eventType: 'error',
      occurredAt: Date.parse('2026-08-10T11:00:00.000Z'),
      body: { category: 'javascript', error: { message: 'boom', stack } },
    },
  });
  if (result.status !== 'inserted') throw new Error(`seed failed: ${result.status}`);
  return result.occurrenceId;
}

describeDb('DAT-18 source-map reparse round (real PostgreSQL 17)', () => {
  let pool: Pool;
  let objectStorage: SourceMapObjectStoragePort;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    // Run the migration dirs idempotently (only un-recorded migrations apply;
    // never drop pgmigrations so other suites' migration records stay intact).
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: processingMigrations,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      checkOrder: false,
      log: () => undefined,
    });
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: releasesMigrations,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      checkOrder: false,
      log: () => undefined,
    });
    // Clean only the tables this suite owns (its fixed project ids), keeping
    // other suites' data and migration records untouched.
    await pool.query(
      `TRUNCATE error_occurrence_symbolizations, source_map_reparse_tasks,
        source_map_files, releases, error_event_occurrences CASCADE`,
    );
    objectStorage = new InMemorySourceMapObjectStorage();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('metadata/store → match → reparse resolves an occurrence source position', async () => {
    // Release identity + Source Map metadata + private content.
    const release = await upsertRelease(pool, { projectId: PROJECT, version: 'shop-web@1.4.3' });
    const objectKey = sourceMapObjectKey(PROJECT, randomUUID());
    await objectStorage.putObject({ key: objectKey, content: MAP_CONTENT });
    const file = await createSourceMapFile(pool, {
      projectId: PROJECT,
      releaseId: release.releaseId,
      buildPath: BUILD_PATH,
      objectKey,
      digest: 'a'.repeat(64),
      buildId: 'build-42',
    });
    expect(file.status).toBe('created');

    // Occurrences: one matching frame (line 1 col 100), one out-of-range
    // position (line 99), one whose frames do not match this build path.
    const matchingId = await seedOccurrence(
      pool,
      PROJECT,
      'Error: boom\n    at render (https://cdn.example.com/assets/app.js:1:100)',
    );
    await seedOccurrence(
      pool,
      PROJECT,
      'Error: boom\n    at render (https://cdn.example.com/assets/app.js:99:100)',
    );
    await seedOccurrence(
      pool,
      PROJECT,
      'Error: boom\n    at other (https://cdn.example.com/assets/vendor.js:1:1)',
    );

    await createReparseTask(pool, {
      projectId: PROJECT,
      releaseId: release.releaseId,
      sourceMapFileId: file.sourceMapFileId,
    });

    const round = await runSourceMapReparseRound({
      pool,
      objectStorage,
      maxTasks: 10,
      maxOccurrences: 100,
    });
    expect(round.processedTasks).toBe(1);
    expect(round.symbolizedOccurrences).toBe(1);
    expect(round.failedTasks).toBe(0);

    // The matching occurrence got a symbolized source position.
    const symbolized = await pool.query<{
      status: string;
      resolved_file: string;
      resolved_line: number;
      resolved_column: number;
      function_name: string;
    }>(
      `SELECT status, resolved_file, resolved_line, resolved_column, function_name
       FROM error_occurrence_symbolizations WHERE occurrence_id = $1`,
      [matchingId],
    );
    expect(symbolized.rows[0]).toMatchObject({
      status: 'symbolized',
      resolved_file: 'src/app.ts',
      resolved_line: 1,
      resolved_column: 0,
      function_name: 'render',
    });

    // Out-of-range position → not_found (never guessed); non-matching path → no row.
    const all = await pool.query<{ status: string }>(
      'SELECT status FROM error_occurrence_symbolizations WHERE project_id = $1',
      [PROJECT],
    );
    expect(all.rows.map((r) => r.status).sort()).toEqual(['not_found', 'symbolized']);

    // A second round is idempotent: no new symbolization work (same map version).
    const second = await runSourceMapReparseRound({
      pool,
      objectStorage,
      maxTasks: 10,
      maxOccurrences: 100,
    });
    expect(second.processedTasks).toBe(0);
  });

  it('replace (new map version) re-processes stale symbolizations', async () => {
    // Separate project: reparse candidates are project-scoped (events carry no
    // release yet), so test 2 must not re-process test 1's occurrences.
    const release = await upsertRelease(pool, {
      projectId: OTHER_PROJECT,
      version: 'shop-web@1.5.0',
    });
    const objectKey = sourceMapObjectKey(OTHER_PROJECT, randomUUID());
    await objectStorage.putObject({ key: objectKey, content: MAP_CONTENT });
    const file = await createSourceMapFile(pool, {
      projectId: OTHER_PROJECT,
      releaseId: release.releaseId,
      buildPath: BUILD_PATH,
      objectKey,
      digest: 'b'.repeat(64),
    });
    expect(file.status).toBe('created');
    await seedOccurrence(
      pool,
      OTHER_PROJECT,
      'Error: boom\n    at render (https://cdn.example.com/assets/app.js:1:100)',
    );
    await createReparseTask(pool, {
      projectId: OTHER_PROJECT,
      releaseId: release.releaseId,
      sourceMapFileId: file.sourceMapFileId,
    });
    let round = await runSourceMapReparseRound({
      pool,
      objectStorage,
      maxTasks: 10,
      maxOccurrences: 100,
    });
    expect(round.symbolizedOccurrences).toBe(1);

    // Replace bumps the map version; the new task re-processes the occurrence.
    const newKey = sourceMapObjectKey(OTHER_PROJECT, randomUUID());
    await objectStorage.putObject({ key: newKey, content: MAP_CONTENT });
    const replaced = await replaceSourceMapFile(pool, {
      projectId: OTHER_PROJECT,
      sourceMapFileId: file.sourceMapFileId,
      objectKey: newKey,
      digest: 'c'.repeat(64),
      version: file.version,
    });
    expect(replaced.status).toBe('replaced');
    await createReparseTask(pool, {
      projectId: OTHER_PROJECT,
      releaseId: release.releaseId,
      sourceMapFileId: file.sourceMapFileId,
    });
    round = await runSourceMapReparseRound({
      pool,
      objectStorage,
      maxTasks: 10,
      maxOccurrences: 100,
    });
    expect(round.symbolizedOccurrences).toBe(1);
    const fresh = await pool.query<{ map_version: number }>(
      'SELECT map_version FROM error_occurrence_symbolizations WHERE project_id = $1',
      [OTHER_PROJECT],
    );
    expect(fresh.rows[0]?.map_version ?? 0).toBeGreaterThanOrEqual(2);
  });
});
