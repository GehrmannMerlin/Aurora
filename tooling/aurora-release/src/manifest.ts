/**
 * OPS-05 immutable artifact identity (deployment.md §5, release-migration-and-rollback.md §1—2).
 *
 * A `ReleaseManifest` pins a deployment to the exact CI-built commit SHA and the
 * content digests of every artifact (ECR image digest / SPA asset hash). The
 * pipeline never rebuilds from a branch in production — only digests that exist
 * in the manifest may be promoted. `assertImmutableArtifact` guards that the
 * manifest was CI-built and every referenced digest is well-formed, so a
 * production deployment can never point at a placeholder or a local build.
 */

export interface ArtifactRef {
  /** ECR image digest, e.g. `sha256:` + 64 hex chars. */
  readonly imageDigest?: string;
  /** SPA content-hash directory prefix (immutable static asset prefix). */
  readonly entryAssetHash?: string;
}

export interface ReleaseManifest {
  /** 40-char hex git commit the artifacts were built from. */
  readonly commitSha: string;
  /** Manifests are only produced by CI. `assertImmutableArtifact` enforces this. */
  readonly builtFrom: 'ci';
  /** Service name -> artifact reference (ingestion-api / ingestion-worker / console). */
  readonly artifacts: Readonly<Record<string, ArtifactRef>>;
  /** Ordered migration version identifiers included in this release. */
  readonly migrationSet: readonly string[];
  /** Public protocol versions this release carries (e.g. event-envelope-v1). */
  readonly protocolVersions: readonly string[];
  /** RFC 3339 UTC timestamp of manifest creation. */
  readonly createdAt: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ASSET_HASH_PATTERN = /^[0-9a-f]{8,64}$/;

function stableError(code: string): Error {
  return new Error(`release_${code}`);
}

export function buildReleaseManifest(input: unknown): ReleaseManifest {
  if (typeof input !== 'object' || input === null) {
    throw stableError('manifest_invalid: expected an object');
  }
  const raw = input as Record<string, unknown>;

  const commitSha = raw.commitSha;
  if (typeof commitSha !== 'string' || !SHA_PATTERN.test(commitSha)) {
    throw stableError(
      `manifest_invalid_commit: commitSha must be a 40-char hex sha, got ${String(commitSha)}`,
    );
  }
  if (raw.builtFrom !== 'ci') {
    throw stableError('manifest_build_source: manifest must be built by CI (builtFrom: "ci")');
  }

  const rawArtifacts = raw.artifacts;
  if (typeof rawArtifacts !== 'object' || rawArtifacts === null || Array.isArray(rawArtifacts)) {
    throw stableError('manifest_invalid_artifacts: artifacts must be an object keyed by service');
  }
  const artifacts: Record<string, ArtifactRef> = {};
  for (const [service, value] of Object.entries(rawArtifacts as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw stableError(`manifest_invalid_artifact: ${service} must be an object`);
    }
    const ref = value as Record<string, unknown>;
    const artifact: { imageDigest?: string; entryAssetHash?: string } = {};
    if (ref.imageDigest !== undefined) {
      if (typeof ref.imageDigest !== 'string' || !DIGEST_PATTERN.test(ref.imageDigest)) {
        throw stableError(
          `manifest_invalid_digest: ${service}.imageDigest must be sha256:<64 hex>`,
        );
      }
      artifact.imageDigest = ref.imageDigest;
    }
    if (ref.entryAssetHash !== undefined) {
      if (typeof ref.entryAssetHash !== 'string' || !ASSET_HASH_PATTERN.test(ref.entryAssetHash)) {
        throw stableError(
          `manifest_invalid_asset_hash: ${service}.entryAssetHash must be hex 8..64 chars`,
        );
      }
      artifact.entryAssetHash = ref.entryAssetHash;
    }
    if (artifact.imageDigest === undefined && artifact.entryAssetHash === undefined) {
      throw stableError(
        `manifest_empty_artifact: ${service} must carry imageDigest or entryAssetHash`,
      );
    }
    artifacts[service] = Object.freeze(artifact);
  }
  if (Object.keys(artifacts).length === 0) {
    throw stableError('manifest_no_artifacts: at least one artifact is required');
  }

  const rawMigrations = raw.migrationSet;
  if (!Array.isArray(rawMigrations)) {
    throw stableError('manifest_invalid_migrations: migrationSet must be an array of strings');
  }
  const migrationSet: string[] = [];
  for (const entry of rawMigrations) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw stableError(
        'manifest_invalid_migrations: migrationSet must be a non-empty array of strings',
      );
    }
    migrationSet.push(entry);
  }
  const protocolVersions = raw.protocolVersions;
  if (!Array.isArray(protocolVersions) || !protocolVersions.every((p) => typeof p === 'string')) {
    throw stableError('manifest_invalid_protocol: protocolVersions must be an array of strings');
  }
  const createdAt = raw.createdAt;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    throw stableError(
      'manifest_invalid_created_at: createdAt must be a parseable RFC 3339 timestamp',
    );
  }

  return Object.freeze({
    commitSha,
    builtFrom: 'ci' as const,
    artifacts: Object.freeze(artifacts),
    migrationSet: Object.freeze(migrationSet),
    protocolVersions: Object.freeze(protocolVersions),
    createdAt,
  });
}

/**
 * Runtime guard that a manifest is CI-built and every referenced digest is
 * well-formed. The parameter accepts a widened `builtFrom` so a hostile or
 * hand-crafted object (e.g. `{ builtFrom: 'local' }`) is caught at runtime
 * even though the typed `ReleaseManifest` narrows it to `'ci'`.
 */
export function assertImmutableArtifact(
  manifest: Readonly<Omit<ReleaseManifest, 'builtFrom'> & { builtFrom: string }>,
): void {
  if (manifest.builtFrom !== 'ci') {
    throw stableError(
      'immutable_violation: production may only deploy CI-built immutable artifacts',
    );
  }
  for (const [service, ref] of Object.entries(manifest.artifacts)) {
    if (ref.imageDigest !== undefined && !DIGEST_PATTERN.test(ref.imageDigest)) {
      throw stableError(`immutable_violation: ${service} has no valid image digest`);
    }
  }
}
