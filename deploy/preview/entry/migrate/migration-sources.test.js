import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverMigrationSources } from './migration-sources.js';

test('discovers migration directories across every workspace package root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aurora-migration-sources-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const expected = [
    join(root, 'apps', 'api', 'migrations'),
    join(root, 'packages', 'identity', 'migrations'),
    join(root, 'tooling', 'operator', 'migrations'),
  ];
  await Promise.all(expected.map((directory) => mkdir(directory, { recursive: true })));
  await mkdir(join(root, 'packages', 'without-migrations'), { recursive: true });
  await mkdir(join(root, 'examples', 'ignored', 'migrations'), { recursive: true });

  assert.deepEqual(await discoverMigrationSources(root), expected);
});
