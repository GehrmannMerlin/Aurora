import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const WORKSPACE_ROOT_NAMES = Object.freeze(['apps', 'packages', 'tooling']);

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function discoverMigrationSources(repositoryRoot) {
  const sources = [];
  for (const workspaceRootName of WORKSPACE_ROOT_NAMES) {
    const workspaceRoot = join(repositoryRoot, workspaceRootName);
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const migrations = join(workspaceRoot, entry.name, 'migrations');
      if (await isDirectory(migrations)) sources.push(migrations);
    }
  }
  return sources;
}
