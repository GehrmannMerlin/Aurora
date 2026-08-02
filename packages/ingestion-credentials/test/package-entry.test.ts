import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ingestion-credentials package entry', () => {
  it('declares the private data-layer package manifest', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: '@aurora/ingestion-credentials',
      private: true,
      type: 'module',
      aurora: { layer: 'data' },
      engines: { node: '>=24.18.0 <25' },
    });
  });

  it('exports only the package root and ships dist', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    const files = (manifest as { files?: unknown }).files;
    expect(files).toContain('dist');
  });

  it('declares pg and no password-hashing or KMS dependencies', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {};
    expect(dependencies.pg).toBe('8.22.0');
    for (const forbidden of [
      'bcrypt',
      'bcryptjs',
      'scrypt',
      'argon2',
      'pbkdf2',
      '@aws-sdk/client-kms',
      'kms',
    ]) {
      expect(dependencies[forbidden]).toBeUndefined();
    }
  });

  it('never exposes private paths through the package exports map', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
  });

  it('does not export the test-only fixture helper', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/create-fixture/);
    expect(index).not.toMatch(/generateFixtureClientKey/);
  });

  it('exports the lifecycle API from the package root', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    for (const name of [
      'createIngestionClientCredential',
      'rotateIngestionClientCredential',
      'disableIngestionClientCredential',
      'enableIngestionClientCredential',
      'revokeIngestionClientCredential',
      'generateClientKeyPair',
    ]) {
      expect(index).toContain(name);
    }
    // Never expose a secret-reveal API.
    expect(index).not.toMatch(/getSecret|revealKey|showSecret/);
  });
});
