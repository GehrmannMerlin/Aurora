import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IngestionBenchmarkReport } from './types.js';

export interface ReportPathOptions {
  readonly outputDir: string;
  readonly profile: string;
  /** Absolute path override only when explicitly provided by the user. */
  readonly explicitAbsolutePath?: string;
}

/**
 * Write a versioned report atomically: write to a temp file in the same
 * directory then rename over the final name. Never overwrites an existing
 * report and refuses paths that escape the project root unless an absolute
 * path is explicitly provided.
 */
export async function writeBenchmarkReport(
  report: IngestionBenchmarkReport,
  options: ReportPathOptions,
): Promise<string> {
  const targetPath = resolveOutputPath(options);
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.tmp-${randomUUID()}.json`);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(tempPath, json, 'utf8');
  await rename(tempPath, targetPath);
  return targetPath;
}

function resolveOutputPath(options: ReportPathOptions): string {
  if (options.explicitAbsolutePath !== undefined) {
    const resolved = resolve(options.explicitAbsolutePath);
    if (!isPathAbsolute(options.explicitAbsolutePath)) {
      throw new Error(
        `output path must be absolute when explicit: ${options.explicitAbsolutePath}`,
      );
    }
    return resolved;
  }
  const projectRoot = resolve(process.cwd());
  const resolved = resolve(projectRoot, options.outputDir);
  if (!resolved.startsWith(projectRoot + sep)) {
    throw new Error(`output path escapes project root: ${options.outputDir}`);
  }
  const utc = new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T');
  return join(resolved, `ingestion-${options.profile}-${utc}.json`);
}

function isPathAbsolute(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}
