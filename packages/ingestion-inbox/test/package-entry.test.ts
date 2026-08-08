import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  claimAvailable,
  markDeadLettered,
  markProcessed,
  persistBatch,
  renewLease,
  replayDeadLettered,
  scheduleRetry,
  type PersistIngestionBatchResult,
  type ReplayDeadLetteredEventResult,
} from '../src/index.js';

describe('ingestion-inbox package entry', () => {
  it('exports persistBatch and public result types from the package root', () => {
    expect(typeof persistBatch).toBe('function');
    const result: PersistIngestionBatchResult = { perEventResults: [] };
    expect(result.perEventResults).toEqual([]);
  });

  it('exports processing-side repository functions from the package root', () => {
    expect(typeof claimAvailable).toBe('function');
    expect(typeof renewLease).toBe('function');
    expect(typeof markProcessed).toBe('function');
    expect(typeof scheduleRetry).toBe('function');
    expect(typeof markDeadLettered).toBe('function');
  });

  it('exports the manual replay function and result type from the package root', () => {
    expect(typeof replayDeadLettered).toBe('function');
    const statuses: ReplayDeadLetteredEventResult['status'][] = [
      'replayed',
      'already_replayed',
      'not_found',
      'invalid_state',
      'operation_conflict',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('declares pg as a production dependency and tooling as devDependencies', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      dependencies: { pg: '8.22.0' },
      aurora: { layer: 'data' },
    });
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new TypeError('manifest must be an object');
    }
    const devDependencies = (manifest as { devDependencies?: unknown }).devDependencies;
    expect(devDependencies).toMatchObject({ 'node-pg-migrate': '9.0.0' });
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
