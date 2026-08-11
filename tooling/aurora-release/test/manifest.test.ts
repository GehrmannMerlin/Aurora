import { describe, expect, it } from 'vitest';
import { assertImmutableArtifact, buildReleaseManifest } from '../src/manifest.js';

const validInput = {
  commitSha: 'a'.repeat(40),
  builtFrom: 'ci',
  artifacts: {
    'ingestion-api': { imageDigest: `sha256:${'b'.repeat(64)}` },
    'ingestion-worker': { imageDigest: `sha256:${'c'.repeat(64)}` },
    console: { entryAssetHash: 'a1b2c3d4' },
  },
  migrationSet: ['1720000000001_ingestion-inbox', '1720000000002_ingestion-credentials'],
  protocolVersions: ['event-envelope-v1'],
  createdAt: '2026-08-11T00:00:00Z',
};

describe('release manifest', () => {
  it('accepts and freezes a valid CI-built manifest', () => {
    const manifest = buildReleaseManifest(validInput);
    expect(manifest.commitSha).toBe('a'.repeat(40));
    expect(manifest.artifacts['ingestion-api']?.imageDigest).toMatch(/^sha256:/);
    expect(Object.isFrozen(manifest.artifacts['ingestion-worker'])).toBe(true);
    expect(Object.isFrozen(manifest.migrationSet)).toBe(true);
  });

  it('rejects a non-CI build source', () => {
    expect(() => buildReleaseManifest({ ...validInput, builtFrom: 'local' })).toThrow(
      'release_manifest_build_source',
    );
  });

  it('rejects a dirty / malformed commit sha', () => {
    expect(() => buildReleaseManifest({ ...validInput, commitSha: 'zz' })).toThrow(
      'release_manifest_invalid_commit',
    );
  });

  it('rejects an artifact with no digest and no asset hash', () => {
    expect(() =>
      buildReleaseManifest({ ...validInput, artifacts: { 'ingestion-api': {} } }),
    ).toThrow('release_manifest_empty_artifact');
  });

  it('rejects an invalid image digest', () => {
    expect(() =>
      buildReleaseManifest({
        ...validInput,
        artifacts: { 'ingestion-api': { imageDigest: 'latest' } },
      }),
    ).toThrow('release_manifest_invalid_digest');
  });

  it('rejects an unparseable createdAt', () => {
    expect(() => buildReleaseManifest({ ...validInput, createdAt: 'not-a-date' })).toThrow(
      'release_manifest_invalid_created_at',
    );
  });

  it('assertImmutableArtifact guards CI-only, well-formed digests', () => {
    const manifest = buildReleaseManifest(validInput);
    expect(() => {
      assertImmutableArtifact(manifest);
    }).not.toThrow();
    expect(() => {
      assertImmutableArtifact({ ...manifest, builtFrom: 'local' });
    }).toThrow('release_immutable_violation');
    expect(() => {
      assertImmutableArtifact({
        ...manifest,
        artifacts: { 'ingestion-api': { imageDigest: 'latest' } },
      });
    }).toThrow('release_immutable_violation');
  });
});
