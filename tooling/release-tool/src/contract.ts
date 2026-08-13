import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The public @aurora/* SDK/protocol packages that may be published to the
 * public npm registry under the `@aurora` scope (G15 decision F).
 *
 * Every other `@aurora/*` package (platform-*, ingestion-*, processing-store,
 * internal tooling, apps) MUST remain `private: true` and is never published.
 */
export const PUBLIC_PACKAGES = [
  '@aurora/event-schema',
  '@aurora/core',
  '@aurora/sdk',
  '@aurora/browser',
  '@aurora/plugin-error',
  '@aurora/plugin-request',
  '@aurora/plugin-performance',
  '@aurora/plugin-vue',
  '@aurora/plugin-react',
] as const;

export type PublicPackageName = (typeof PUBLIC_PACKAGES)[number];

export interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly exports?: Record<string, unknown>;
  readonly files?: readonly string[];
  readonly types?: string;
  readonly main?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: { readonly access?: string };
  readonly license?: string;
}

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly manifest: PackageManifest;
}

/** Read and JSON-parse a package manifest at `dir/package.json`. */
export function readManifest(dir: string): PackageManifest {
  const raw = readFileSync(join(dir, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageManifest;
}

/**
 * Discover every package manifest under `packages/` (and tooling/ apps/
 * examples/ when included) in the workspace at `root`, by name.
 */
export function discoverWorkspacePackages(
  root: string,
  roots: readonly string[] = ['packages', 'tooling', 'apps', 'examples'],
): Map<string, WorkspacePackage> {
  const found = new Map<string, WorkspacePackage>();
  for (const rootDir of roots) {
    const base = join(root, rootDir);
    let entries: string[];
    try {
      entries = readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = join(base, name);
      try {
        const manifest = readManifest(dir);
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@aurora/')) {
          found.set(manifest.name, { name: manifest.name, dir, manifest });
        }
      } catch {
        // Not a package directory (no package.json) — ignore.
      }
    }
  }
  return found;
}

/** The 9 public packages discovered from the workspace, keyed by name. */
export function discoverPublicPackages(root: string): Map<string, WorkspacePackage> {
  const all = discoverWorkspacePackages(root);
  const publicPackages = new Map<string, WorkspacePackage>();
  for (const name of PUBLIC_PACKAGES) {
    const pkg = all.get(name);
    if (pkg !== undefined) publicPackages.set(name, pkg);
  }
  return publicPackages;
}

export function isPublicPackageName(name: string): name is PublicPackageName {
  return (PUBLIC_PACKAGES as readonly string[]).includes(name);
}

export interface ValidationIssue {
  readonly packageName: string;
  readonly message: string;
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => `${issue.packageName}: ${issue.message}`)
    .join('\n');
}
