import { describe, expect, it } from 'vitest';
import { ProcessingStoreError } from '@aurora/processing-store';
import { mapErrorToProblem } from '../src/error-mapper.js';

describe('mapErrorToProblem (stable data-layer errors)', () => {
  it('maps a ProcessingStoreError invalid_input to a 400 structural_error', () => {
    const mapped = mapErrorToProblem(
      'req-1',
      new ProcessingStoreError('invalid_input', 'malformed endpoint cursor'),
    );
    expect(mapped.status).toBe(400);
    expect(mapped.problem.code).toBe('structural_error');
    expect(mapped.problem.requestId).toBe('req-1');
    expect(mapped.problem.detail).toBe('Request does not match the public contract.');
  });

  it('maps a ProcessingStoreError database_unavailable to a 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-2',
      new ProcessingStoreError('database_unavailable', 'authority unreachable'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.requestId).toBe('req-2');
    expect(mapped.problem.detail).toBe('Authority is temporarily unavailable.');
  });

  it('maps a ProcessingStoreError statement_failed to a 503 authority_unavailable', () => {
    const mapped = mapErrorToProblem(
      'req-3',
      new ProcessingStoreError('statement_failed', 'request metric summary query failed'),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.problem.code).toBe('authority_unavailable');
    expect(mapped.problem.requestId).toBe('req-3');
  });

  it('never surfaces the internal message or stack for a ProcessingStoreError', () => {
    const mapped = mapErrorToProblem(
      'req-4',
      new ProcessingStoreError('invalid_input', 'malformed endpoint cursor'),
    );
    const raw = JSON.stringify(mapped.problem);
    expect(raw).not.toContain('malformed endpoint cursor');
    expect(raw).not.toContain('ProcessingStoreError');
  });
});
