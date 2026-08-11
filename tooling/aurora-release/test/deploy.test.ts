import { describe, expect, it } from 'vitest';
import { buildReleaseManifest, type ReleaseManifest } from '../src/manifest.js';
import { assertSafeDeployment, planDeployment } from '../src/deploy.js';

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
    'ingestion-api': { imageDigest: `sha256:${'e'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'f'.repeat(64)}` },
    console: { entryAssetHash: 'f5e4d3c2' },
  },
  { commitSha: 'd'.repeat(40), createdAt: '2026-08-10T00:00:00Z' },
);

describe('deployment plan', () => {
  it('orders migrate -> api -> worker -> spa entry switch', () => {
    const steps = planDeployment(
      current,
      previous,
      { services: ['ingestion-api', 'ingestion-worker'], spa: true, migrate: true },
      ['node-pg-migrate up --migrations-dir x'],
    );
    expect(steps.map((step) => step.kind)).toEqual([
      'migrate',
      'update-service',
      'update-service',
      'switch-spa-entry',
    ]);
  });

  it('skips services whose digest is unchanged from the previous manifest', () => {
    const sameApi = manifestFor({
      'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
      'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
    });
    const steps = planDeployment(
      sameApi,
      current,
      { services: ['ingestion-api', 'ingestion-worker'], spa: false, migrate: false },
      [],
    );
    expect(steps.filter((step) => step.kind === 'update-service')).toHaveLength(0);
  });

  it('does not emit a SPA switch when the entry hash is unchanged', () => {
    const steps = planDeployment(current, current, { services: [], spa: true, migrate: false }, []);
    expect(steps.filter((step) => step.kind === 'switch-spa-entry')).toHaveLength(0);
  });

  it('rejects a target service that has no digest in the manifest', () => {
    const noWorker = manifestFor({
      'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
    });
    expect(() =>
      planDeployment(
        noWorker,
        previous,
        { services: ['ingestion-worker'], spa: false, migrate: false },
        [],
      ),
    ).toThrow('unsafe_deployment: ingestion-worker has no image digest in manifest');
  });

  it('rejects a manifest that is not CI-built', () => {
    const local = { ...current, builtFrom: 'local' } as unknown as ReleaseManifest;
    expect(() =>
      planDeployment(local, previous, { services: [], spa: false, migrate: false }, []),
    ).toThrow('release_immutable_violation');
  });

  it('assertSafeDeployment rejects a migrate step carrying a destructive down command', () => {
    expect(() => {
      assertSafeDeployment([{ kind: 'migrate', commands: ['node-pg-migrate down'] }]);
    }).toThrow('unsafe_deployment');
  });

  it('assertSafeDeployment accepts forward-only migrate commands', () => {
    expect(() => {
      assertSafeDeployment([
        { kind: 'migrate', commands: ['node-pg-migrate up --migrations-dir x'] },
        {
          kind: 'update-service',
          service: 'ingestion-api',
          imageDigest: `sha256:${'b'.repeat(64)}`,
        },
      ]);
    }).not.toThrow();
  });
});
