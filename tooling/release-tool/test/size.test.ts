import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLIC_PACKAGES } from '../src/contract.js';
import { measureBundle, runSizeGate, SIZE_BUDGETS } from '../src/size.js';

/** Genuinely incompressible deterministic payload (SHA-256 base64). */
function incompressiblePayload(length: number): string {
  let out = '';
  let counter = 0;
  while (out.length < length) {
    out += createHash('sha256').update(`seed:${counter}`).digest('base64');
    counter += 1;
  }
  return out.slice(0, length);
}

describe('SIZE_BUDGETS', () => {
  it('covers the approved budgets only', () => {
    expect(SIZE_BUDGETS.map((b) => b.packageName)).toEqual([
      '@aurora/core',
      '@aurora/browser',
      '@aurora/plugin-error',
      '@aurora/plugin-request',
      '@aurora/plugin-performance',
      '@aurora/plugin-vue',
      '@aurora/plugin-react',
    ]);
    const core = SIZE_BUDGETS.find((b) => b.packageName === '@aurora/core');
    expect(core?.limitBytes).toBe(10 * 1024);
    const browser = SIZE_BUDGETS.find((b) => b.packageName === '@aurora/browser');
    expect(browser?.limitBytes).toBe(30 * 1024);
    const plugin = SIZE_BUDGETS.find((b) => b.packageName === '@aurora/plugin-error');
    expect(plugin?.limitBytes).toBe(8 * 1024);
    const adapter = SIZE_BUDGETS.find((b) => b.packageName === '@aurora/plugin-vue');
    expect(adapter?.limitBytes).toBe(5 * 1024);
  });
});

describe('measureBundle', () => {
  it('bundles and reports raw + gzip sizes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-size-'));
    try {
      const entry = join(root, 'entry.ts');
      writeFileSync(entry, 'export const a = "hello";\n');
      const { bytes, gzipBytes } = await measureBundle(entry, []);
      expect(bytes).toBeGreaterThan(0);
      expect(gzipBytes).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('runSizeGate', () => {
  it('passes for tiny public packages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-size-'));
    try {
      for (const name of PUBLIC_PACKAGES) {
        const dir = join(root, 'packages', name.replace('@aurora/', ''));
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true }));
        writeFileSync(join(dir, 'dist', 'index.js'), 'export const x = 1;\n');
      }
      const result = await runSizeGate(root);
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.results.length).toBe(SIZE_BUDGETS.length + 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a failure when a bundled entry exceeds its budget', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-size-'));
    try {
      for (const name of PUBLIC_PACKAGES) {
        const dir = join(root, 'packages', name.replace('@aurora/', ''));
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true }));
        const payload = name === '@aurora/core' ? incompressiblePayload(64 * 1024) : 'export const x = 1;';
        writeFileSync(join(dir, 'dist', 'index.js'), `export const blob = ${JSON.stringify(payload)};\n`);
      }
      const result = await runSizeGate(root);
      expect(result.ok).toBe(false);
      const core = result.results.find((r) => r.packageName === '@aurora/core');
      expect(core?.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
