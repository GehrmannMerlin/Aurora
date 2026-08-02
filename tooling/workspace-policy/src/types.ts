export type WorkspaceViolationCode =
  | 'invalid-package-name'
  | 'missing-package-field'
  | 'non-workspace-local-dependency'
  | 'undeclared-dependency'
  | 'dependency-cycle'
  | 'private-path-import'
  | 'forbidden-layer-dependency'
  | 'forbidden-runtime-global'
  | 'mutable-module-state'
  | 'forbidden-host-mutation'
  | 'forbidden-host-event-control';

export interface WorkspaceViolation {
  readonly code: WorkspaceViolationCode;
  readonly packageName: string;
  readonly file?: string;
  readonly dependency?: string;
  readonly message: string;
}

export interface WorkspaceCheckResult {
  readonly ok: boolean;
  readonly violations: readonly WorkspaceViolation[];
}

export interface PackageManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly type?: unknown;
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly engines?: unknown;
  readonly scripts?: unknown;
  readonly aurora?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly [key: string]: unknown;
}

export interface WorkspacePackage {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly name: string;
}
