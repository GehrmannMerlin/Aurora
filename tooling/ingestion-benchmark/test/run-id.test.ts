import { describe, expect, it } from 'vitest';
import { generateRunId, schemaNameForRunId } from '../src/run-id.js';

describe('run-id', () => {
  it('generates distinct UUID run ids', () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('derives a schema name without hyphens and within identifier limits', () => {
    const schema = schemaNameForRunId('00000000-0000-4000-8000-000000000001');
    expect(schema).toBe('aurora_bench_00000000000040008000000000000001');
    expect(schema).not.toContain('-');
    expect(schema.length).toBeLessThanOrEqual(63);
  });
});
