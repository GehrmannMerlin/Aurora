import { describe, expect, it } from 'vitest';
import { persistIssueContribution } from '../src/index.js';

/** Any attempt to connect proves the input was accepted past validation (we want the opposite). */
const explodingPool = {
  connect: () => {
    throw new Error('pool.connect must not be called for invalid input');
  },
} as never;

const valid: Record<string, unknown> = {
  projectId: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'v1|javascript|TypeError|boom',
  fingerprintVersion: 1,
  category: 'javascript',
  normalizedTitle: 'boom',
  eventId: 'evt-issue-1',
  occurredAtIso: '2026-08-10T00:00:00.000Z',
  sampleBody: { category: 'javascript', error: { message: 'boom' } },
};

describe('persistIssueContribution input validation', () => {
  it('rejects non-object top-level input', async () => {
    for (const bad of [null, undefined, [], 'x', 42]) {
      const result = await persistIssueContribution(explodingPool, bad);
      expect(result).toEqual({ status: 'invalid_input', code: 'invalid_top_level' });
    }
  });

  it('rejects invalid fields', async () => {
    const cases: [Partial<typeof valid>, string][] = [
      [{ projectId: '' }, 'invalid_project_id'],
      [{ fingerprint: '' }, 'invalid_fingerprint'],
      [{ fingerprint: 'x'.repeat(1025) }, 'invalid_fingerprint'],
      [{ fingerprintVersion: 1.5 }, 'invalid_fingerprint_version'],
      [{ category: 'bogus' }, 'invalid_category'],
      [{ normalizedTitle: '' }, 'invalid_normalized_title'],
      [{ eventId: '' }, 'invalid_event_id'],
      [{ occurredAtIso: 'not-a-date' }, 'invalid_occurred_at'],
      [{ sampleBody: 'text' }, 'invalid_sample_body'],
    ];
    for (const [patch, code] of cases) {
      const result = await persistIssueContribution(explodingPool, { ...valid, ...patch });
      expect(result, code).toEqual({ status: 'invalid_input', code });
    }
  });

  it('accepts the frozen valid shape (would connect next)', async () => {
    // This asserts the validator accepts the valid shape by expecting the pool
    // to be reached (which throws the sentinel), proving no early rejection.
    await expect(persistIssueContribution(explodingPool, valid)).rejects.toThrow(
      'pool.connect must not be called',
    );
  });
});
