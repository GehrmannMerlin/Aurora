import { describe, expect, it } from 'vitest';
import { buildReleaseManifest, type ReleaseManifest } from '../src/manifest.js';
import { assertNoDestructiveMigrationRollback, planRollback } from '../src/rollback.js';

function manifestFor(
  artifacts: ReleaseManifest['artifacts'],
  overrides: Partial<Omit<ReleaseManifest, 'artifacts'>> = {},
): ReleaseManifest {
  return buildReleaseManifest({
    commitSha: overrides.commitSha ?? 'a'.repeat(40),
    builtFrom: 'ci',
    artifacts,
    migrationSet: ['1720000000001_init'],
    protocolVersions: ['event-envelope-v1'],
    createdAt: overrides.createdAt ?? '2026-08-11T00:00:00Z',
  });
}

const current = manifestFor({
  'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
  'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
  console: { entryAssetHash: 'a1b2c3d4' },
});
const previous = manifestFor(
  {
    'ingestion-api': { imageDigest: `sha256:${'d'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'e'.repeat(64)}` },
    console: { entryAssetHash: 'f5e4d3c2' },
  },
  { commitSha: 'f'.repeat(40), createdAt: '2026-08-10T00:00:00Z' },
);

describe('rollback plan', () => {
  it('rolls each changed service back to the previous digest and reverts the SPA entry', () => {
    const plan = planRollback(current, previous);
    expect(plan.serviceRollbacks.map((rollback) => rollback.service).sort()).toEqual([
      'ingestion-api',
      'ingestion-worker',
    ]);
    expect(plan.revertSpaEntry).toBe('f5e4d3c2');
  });

  it('skips services whose digest did not change', () => {
    const unchangedApi = manifestFor({
      'ingestion-api': { imageDigest: `sha256:${'d'.repeat(64)}` }, // same as previous
      'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
      console: { entryAssetHash: 'a1b2c3d4' },
    });
    const plan = planRollback(unchangedApi, previous);
    expect(plan.serviceRollbacks.map((rollback) => rollback.service)).toEqual(['ingestion-worker']);
  });

  it('sets workerPause when a worker digest is reverted (drain-aware rollback)', () => {
    const plan = planRollback(current, previous);
    expect(plan.workerPause).toBe(true);
  });

  it('does not pause the worker when only the API changed', () => {
    const apiOnlyCurrent = manifestFor({
      'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
      'ingestion-worker': { imageDigest: `sha256:${'e'.repeat(64)}` }, // same as previous
      console: { entryAssetHash: 'a1b2c3d4' },
    });
    const plan = planRollback(apiOnlyCurrent, previous);
    expect(plan.workerPause).toBe(false);
  });

  it('never rolls the database back destructively', () => {
    const plan = planRollback(current, previous);
    expect(plan.note).toContain('no destructive DB migration');
    expect(() => {
      assertNoDestructiveMigrationRollback(plan);
    }).not.toThrow();
  });
});
