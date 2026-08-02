import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function collectTsFiles(dir: URL): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(new URL(`${entry.name}/`, dir))));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fileURLToPath(new URL(entry.name, dir)));
    }
  }
  return files;
}

describe('ingestion-credentials security negatives', () => {
  const srcDir = new URL('../src/', import.meta.url);

  it('does not log raw keys, secrets, digests, SQLSTATE, or database URLs', async () => {
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/console\.log/);
      expect(content).not.toMatch(/SQLSTATE/);
      expect(content).not.toMatch(/postgres:\/\/[^"'`]*:[^"'`]*@/);
      expect(content).not.toMatch(/secret.*console\.|console\..*secret/i);
      expect(content).not.toMatch(/clientKey.*console\.|console\..*clientKey/i);
    }
  });

  it('never exposes a secret-reveal function or Math.random in source', async () => {
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/getSecret|revealKey|showSecret/);
      expect(content).not.toMatch(/Math\.random/);
    }
  });

  it('does not write the client key into any persisted snapshot', async () => {
    // The fixture generator produces dynamic keys; no source file hard-codes one.
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/aurora_ingest_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}/);
    }
  });

  it('does not reference password-hashing or KMS libraries', async () => {
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/bcrypt|scrypt|argon2|pbkdf2/i);
      expect(content).not.toMatch(/kms|hsm/i);
    }
  });

  it('never exports the fixture helper from the package root', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/create-fixture/);
    expect(index).not.toMatch(/generateFixtureClientKey/);
  });
});
