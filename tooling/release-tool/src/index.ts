/**
 * @aurora/release-tool — Aurora SDK release contract engine (OPS-03).
 *
 * Private tooling package. Provides the release chain gates used by the SDK
 * publish workflow: validate, version, pack, compat, size, deprecate/latest.
 */
export {
  PUBLIC_PACKAGES,
  discoverPublicPackages,
  discoverWorkspacePackages,
  isPublicPackageName,
  readManifest,
  type PackageManifest,
  type PublicPackageName,
  type ValidationIssue,
  type WorkspacePackage,
} from './contract.js';

export {
  bumpSemver,
  compareSemver,
  formatSemver,
  parseSemver,
  parseSemverResult,
  withPrerelease,
  type ParsedSemver,
  type SemverBump,
} from './semver.js';

export { validateWorkspace, isAllowedDependencyRange, type ValidateResult } from './validate.js';

export {
  parseChangesetFile,
  planVersions,
  readChangesets,
  renderChangelog,
  rewriteWorkspaceDeps,
  type Changeset,
  type VersionPlanEntry,
} from './version.js';

export {
  checkExportsTypes,
  checkProtocolDecoupling,
  checkWorkspaceDepRewritePlan,
  readProtocolVersion,
  type ProtocolVersionCheck,
} from './compat.js';

export {
  RECORD_ONLY_PACKAGES,
  SIZE_BUDGETS,
  formatSizeResults,
  measureBundle,
  runSizeGate,
  type BundleMeasurement,
  type SizeBudget,
} from './size.js';

export {
  assertTarballContents,
  listPackedFiles,
  type PackedEntry,
  type TarballAssertion,
} from './pack.js';

export {
  buildDeprecateArgs,
  buildDistTagArgs,
  describeRollback,
} from './deprecate.js';

export { runCli, parseArgs, type CliOptions, type CommandName } from './cli.js';
