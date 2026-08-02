import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildIngestionApi, loadIngestionApiConfig } from '../src/index.js';

describe('ingestion-api package entry', () => {
  it('exports the public application factory and config loader', () => {
    expect(typeof buildIngestionApi).toBe('function');
    expect(typeof loadIngestionApiConfig).toBe('function');
  });

  it('declares fastify as a production dependency and service layer', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      private: true,
      dependencies: {
        fastify: '5.10.0',
        '@aurora/event-schema': 'workspace:*',
        '@aurora/ingestion-inbox': 'workspace:*',
      },
      aurora: { layer: 'service' },
    });
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
});
