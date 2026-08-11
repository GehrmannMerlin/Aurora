/**
 * OPS-05 deployment planner (release-migration-and-rollback.md §2, §4).
 *
 * `planDeployment` turns an immutable `ReleaseManifest` and an optional previous
 * manifest into an ordered, per-unit deployment plan:
 *
 *   1. `migrate`        — forward-compatible migration commands (rendered by
 *                         `migrations.ts`), only when the release includes DB
 *                         changes and the caller opts in via `targets.migrate`.
 *   2. `update-service` — one step per service whose image digest changed vs the
 *                         previous manifest. Unchanged services are skipped
 *                         (no-op), so re-running a manifest is safe.
 *   3. `switch-spa-entry` — atomic SPA entry switch to the content-hash asset
 *                         prefix. SPA / API / Worker stay separate rollback
 *                         units (Release §4).
 *
 * `assertSafeDeployment` is the last-line guard: it refuses any migrate step
 * that would run a destructive `down` migration — the pipeline never auto-runs
 * a database rollback.
 */

import { assertImmutableArtifact, type ReleaseManifest } from './manifest.js';

export type DeploymentStep =
  | { readonly kind: 'migrate'; readonly commands: readonly string[] }
  | { readonly kind: 'update-service'; readonly service: string; readonly imageDigest: string }
  | { readonly kind: 'switch-spa-entry'; readonly assetHash: string };

export interface DeploymentTargets {
  /** Service names in `manifest.artifacts` to update (digest changed only). */
  readonly services: readonly string[];
  /** Switch the SPA entry to the manifest's console content-hash prefix. */
  readonly spa?: boolean;
  /** Include the forward-compatible migration commands as the first step. */
  readonly migrate?: boolean;
}

export function planDeployment(
  manifest: ReleaseManifest,
  previous: ReleaseManifest | undefined,
  targets: DeploymentTargets,
  migrationCommands: readonly string[],
): readonly DeploymentStep[] {
  assertImmutableArtifact(manifest);
  const steps: DeploymentStep[] = [];
  if (targets.migrate === true) {
    steps.push({ kind: 'migrate', commands: migrationCommands });
  }
  for (const service of targets.services) {
    const ref = manifest.artifacts[service];
    const previousRef = previous?.artifacts[service];
    if (ref?.imageDigest === undefined) {
      throw new Error(`unsafe_deployment: ${service} has no image digest in manifest`);
    }
    if (previousRef?.imageDigest === ref.imageDigest) continue; // no-op: already on this digest
    steps.push({ kind: 'update-service', service, imageDigest: ref.imageDigest });
  }
  if (targets.spa === true) {
    const spa = manifest.artifacts.console;
    const previousSpa = previous?.artifacts.console?.entryAssetHash;
    if (spa?.entryAssetHash !== undefined && spa.entryAssetHash !== previousSpa) {
      steps.push({ kind: 'switch-spa-entry', assetHash: spa.entryAssetHash });
    }
  }
  return Object.freeze(steps);
}

export function assertSafeDeployment(steps: readonly DeploymentStep[]): void {
  for (const step of steps) {
    if (step.kind !== 'migrate') continue;
    for (const command of step.commands) {
      if (/\bdown\b/.test(command)) {
        throw new Error('unsafe_deployment: destructive down migration is never auto-run');
      }
    }
  }
}
