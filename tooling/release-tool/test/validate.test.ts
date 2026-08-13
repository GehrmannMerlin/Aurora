import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPublicPackageName, PUBLIC_PACKAGES } from '../src/contract.js';
import { validateWorkspace } from '../src/validate.js';

function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'aurora-release-validate-'));
}

function writePackage(root: string, name: string, manifest: Record<string, unknown>): void {
  const dir = join(root, 'packages', name);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'dist', 'index.js'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'dist', 'index.d.ts'), 'export declare const x = 1;\n');
  writeFileSync(join(dir, 'README.md'), '# readme\n');
}

function publicManifest(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    version: '0.0.0',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    files: ['dist', 'README.md'],
    publishConfig: { access: 'public' },
    ...overrides,
  };
}

function writeAllPublic(root: string, overridesFor?: { name: string; overrides: Record<string, unknown> }): void {
  for (const name of PUBLIC_PACKAGES) {
    const dirName = name.replace('@aurora/', '');
    const overrides = overridesFor?.name === name ? overridesFor.overrides : {};
    writePackage(root, dirName, publicManifest(name, overrides));
  }
}

describe('isPublicPackageName', () => {
  it('recognizes the 9 public packages', () => {
    expect(isPublicPackageName('@aurora/event-schema')).toBe(true);
    expect(isPublicPackageName('@aurora/plugin-react')).toBe(true);
    expect(isPublicPackageName('@aurora/platform-identity')).toBe(false);
  });
});

describe('validateWorkspace', () => {
  it('accepts 9 well-formed public packages', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root);
      const result = validateWorkspace(root);
      expect(result.ok).toBe(true);
      expect(result.publicChecked).toBe(9);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a private public package without publishConfig', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root, {
        name: '@aurora/event-schema',
        overrides: { private: true, publishConfig: undefined },
      });
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      const messages = result.issues.map((issue) => issue.message).join(' | ');
      expect(messages).toContain('must not be private');
      expect(messages).toContain('publishConfig.access');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a dangling exports types target', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root, {
        name: '@aurora/core',
        overrides: { exports: { '.': { types: './dist/missing.d.ts', import: './dist/index.js' } } },
      });
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.message).join(' | ')).toContain('target does not exist');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects forbidden dependency specifiers', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root, {
        name: '@aurora/sdk',
        overrides: { dependencies: { '@aurora/event-schema': 'file:../event-schema' } },
      });
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.message).join(' | ')).toContain('forbidden specifier');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a files list missing a present README', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root, {
        name: '@aurora/browser',
        overrides: { files: ['dist'] },
      });
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.message).join(' | ')).toContain('files must include README.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces that non-public @aurora packages stay private', () => {
    const root = makeTempWorkspace();
    try {
      writeAllPublic(root);
      writePackage(root, 'platform-identity', {
        name: '@aurora/platform-identity',
        version: '0.0.0',
        private: false,
      });
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.message).join(' | ')).toContain('must set private: true');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when a public package is missing from the workspace', () => {
    const root = makeTempWorkspace();
    try {
      const subset = PUBLIC_PACKAGES.filter((name) => name !== '@aurora/plugin-vue');
      for (const name of subset) {
        writePackage(root, name.replace('@aurora/', ''), publicManifest(name));
      }
      const result = validateWorkspace(root);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.message).join(' | ')).toContain('expected 9 public packages');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
