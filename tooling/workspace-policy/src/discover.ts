import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { PackageManifest, WorkspacePackage } from './types.js';

const workspaceRoots = ['apps', 'packages', 'examples', 'tooling'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readManifest(manifestPath: string): Promise<PackageManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`Package manifest is not an object: ${manifestPath}`);
  }
  return parsed;
}

export async function discoverWorkspacePackages(
  rootDir: string,
): Promise<readonly WorkspacePackage[]> {
  const rootStat = await stat(rootDir).catch((error: unknown) => {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!rootStat?.isDirectory()) {
    throw new Error(`Root directory does not exist or is not a directory: ${rootDir}`);
  }
  const discovered: WorkspacePackage[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const directory = join(rootDir, workspaceRoot);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDirectory = join(directory, entry.name);
      const manifestPath = join(packageDirectory, 'package.json');
      const manifest = await readManifest(manifestPath);
      const name =
        typeof manifest.name === 'string'
          ? manifest.name
          : `<${relative(rootDir, packageDirectory)}>`;
      discovered.push({
        directory: packageDirectory,
        manifest,
        manifestPath,
        name,
      });
    }
  }
  return discovered.sort((left, right) => left.name.localeCompare(right.name));
}
