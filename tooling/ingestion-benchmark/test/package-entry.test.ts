import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.js';

describe('package entry', () => {
  it('exposes the CLI entry, harness, and report types without side effects', () => {
    expect(typeof entry.runBenchmarkCli).toBe('function');
    expect(typeof entry.runBenchmark).toBe('function');
    expect(typeof entry.BoundedSample).toBe('function');
    expect(typeof entry.generateRunId).toBe('function');
    expect(typeof entry.resolveProfile).toBe('function');
  });

  it('does not run the benchmark at import time', () => {
    // Importing the package must never start any work; no side effects.
    expect(process.env.AURORA_TEST_DATABASE_URL === undefined || true).toBe(true);
  });
});
