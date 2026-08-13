import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { discoverPublicPackages, type ValidationIssue } from './contract.js';

/**
 * Tree-shaken / gzip size gate for the public SDK entries, using the approved
 * budgets from test-strategy §5:
 *   - Core 基础包                         gzip ≤ 10 KiB
 *   - Browser＋Core 最小接入              gzip ≤ 30 KiB
 *   - 单个可选插件增量                    gzip ≤  8 KiB
 *   - 单个 Vue/React 适配增量            gzip ≤  5 KiB
 * Measurement definition (documented in the OPS-03 release spec): each entry
 * is bundled with esbuild (`bundle + minify`), with `@aurora/*` externals so
 * only the package's OWN code is counted as its increment; the browser entry
 * is bundled with no externals so it measures the full minimal integration
 * (browser + core + sdk + protocol). gzip size of the bundled output is the gate.
 */

export interface SizeBudget {
  readonly packageName: string;
  readonly externals: readonly string[];
  readonly limitBytes: number;
}

export const SIZE_BUDGETS: readonly SizeBudget[] = [
  { packageName: '@aurora/core', externals: ['@aurora/*'], limitBytes: 10 * 1024 },
  { packageName: '@aurora/browser', externals: [], limitBytes: 30 * 1024 },
  { packageName: '@aurora/plugin-error', externals: ['@aurora/*'], limitBytes: 8 * 1024 },
  { packageName: '@aurora/plugin-request', externals: ['@aurora/*'], limitBytes: 8 * 1024 },
  { packageName: '@aurora/plugin-performance', externals: ['@aurora/*'], limitBytes: 8 * 1024 },
  { packageName: '@aurora/plugin-vue', externals: ['@aurora/*', 'vue'], limitBytes: 5 * 1024 },
  {
    packageName: '@aurora/plugin-react',
    externals: ['@aurora/*', 'react', 'react-dom'],
    limitBytes: 5 * 1024,
  },
];

/** Packages without an approved budget are measured and recorded as evidence. */
export const RECORD_ONLY_PACKAGES = ['@aurora/event-schema', '@aurora/sdk'] as const;

export interface BundleMeasurement {
  readonly packageName: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly limitBytes: number | null;
  readonly ok: boolean;
}

export async function measureBundle(entryAbs: string, externals: readonly string[]): Promise<{ bytes: number; gzipBytes: number }> {
  const result = await build({
    entryPoints: [entryAbs],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    external: [...externals],
    write: false,
    logLevel: 'silent',
  });
  const text = result.outputFiles[0]?.text ?? '';
  const bytes = Buffer.byteLength(text, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(text, 'utf8')).byteLength;
  return { bytes, gzipBytes };
}

export async function runSizeGate(root: string): Promise<{
  readonly ok: boolean;
  readonly results: readonly BundleMeasurement[];
  readonly issues: readonly ValidationIssue[];
}> {
  const publicPackages = discoverPublicPackages(root);
  const results: BundleMeasurement[] = [];
  const issues: ValidationIssue[] = [];
  for (const budget of SIZE_BUDGETS) {
    const pkg = publicPackages.get(budget.packageName);
    if (pkg === undefined) {
      issues.push({ packageName: budget.packageName, message: 'public package not found in workspace' });
      continue;
    }
    const entryAbs = join(pkg.dir, 'dist', 'index.js');
    if (!existsSync(entryAbs)) {
      issues.push({ packageName: budget.packageName, message: `dist/index.js missing — run pnpm build first (${entryAbs})` });
      continue;
    }
    const { gzipBytes, bytes } = await measureBundle(entryAbs, budget.externals);
    results.push({
      packageName: budget.packageName,
      bytes,
      gzipBytes,
      limitBytes: budget.limitBytes,
      ok: gzipBytes <= budget.limitBytes,
    });
  }
  for (const name of RECORD_ONLY_PACKAGES) {
    const pkg = publicPackages.get(name);
    if (pkg === undefined) continue;
    const entryAbs = join(pkg.dir, 'dist', 'index.js');
    if (!existsSync(entryAbs)) continue;
    const { gzipBytes, bytes } = await measureBundle(entryAbs, ['@aurora/*']);
    results.push({ packageName: name, bytes, gzipBytes, limitBytes: null, ok: true });
  }
  const exceeded = results.filter((result) => result.ok === false);
  return { ok: exceeded.length === 0 && issues.length === 0, results, issues };
}

export function formatSizeResults(results: readonly BundleMeasurement[]): string {
  const lines = results.map((result) => {
    const limit = result.limitBytes === null ? 'record' : `${(result.limitBytes / 1024).toFixed(1)} KiB`;
    const status = result.limitBytes === null ? '' : result.ok ? 'PASS' : 'FAIL';
    return `${result.packageName.padEnd(22)} gzip=${(result.gzipBytes / 1024).toFixed(2)} KiB raw=${(result.bytes / 1024).toFixed(2)} KiB limit=${limit} ${status}`;
  });
  return lines.join('\n');
}
