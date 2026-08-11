/**
 * Rollback / deprecate helpers for the release chain (G15 decision G and the
 * approved release policy in docs/releases/release-migration-and-rollback.md):
 * a bad published version is deprecated, `latest` is restored to the last
 * known-good stable version, and a corrected patch goes through the stable
 * path again. Immutable versions are never overwritten; historical tags are
 * never modified. These builders stay pure so the CLI can print or dry-run.
 */

export function buildDeprecateArgs(
  packageName: string,
  version: string,
  message: string,
): string[] {
  return ['deprecate', `${packageName}@${version}`, message];
}

export function buildDistTagArgs(
  packageName: string,
  version: string,
  tag: string,
): string[] {
  return ['dist-tag', 'add', `${packageName}@${version}`, tag];
}

export function describeRollback(
  packageName: string,
  badVersion: string,
  knownGoodVersion: string,
): string[] {
  return [
    `1. npm deprecate ${packageName}@${badVersion} "replaced by ${knownGoodVersion}"`,
    `2. npm dist-tag add ${packageName}@${knownGoodVersion} latest`,
    `3. publish a corrected patch (bump patch) through the stable release path`,
  ];
}
