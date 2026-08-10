import { describe, expect, it } from 'vitest';
import { IngestionInboxError } from '../src/errors.js';
import { accumulateByState } from '../src/diagnostics-query.js';

describe('queryProjectInboxDiagnostics pure state assembly', () => {
  it('returns a full five-state zero map for no rows', () => {
    expect(accumulateByState([])).toEqual({
      pending: 0,
      leased: 0,
      retry_waiting: 0,
      processed: 0,
      dead_lettered: 0,
    });
  });

  it('fills each present state and leaves missing states at zero', () => {
    const result = accumulateByState([
      { state: 'processed', cnt: '2' },
      { state: 'pending', cnt: '1' },
      { state: 'retry_waiting', cnt: '1' },
      { state: 'dead_lettered', cnt: '1' },
    ]);
    expect(result).toEqual({
      pending: 1,
      leased: 0,
      retry_waiting: 1,
      processed: 2,
      dead_lettered: 1,
    });
  });

  it('maps bigint string counts to numbers', () => {
    const result = accumulateByState([{ state: 'leased', cnt: '7' }]);
    expect(result.leased).toBe(7);
  });

  it('rejects an unknown state as invalid_input', () => {
    expect(() => accumulateByState([{ state: 'mystery', cnt: '1' }])).toThrow(IngestionInboxError);
    try {
      accumulateByState([{ state: 'mystery', cnt: '1' }]);
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionInboxError);
      expect((error as IngestionInboxError).kind).toBe('invalid_input');
    }
  });
});
