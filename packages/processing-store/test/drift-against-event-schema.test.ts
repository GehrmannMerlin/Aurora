import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ErrorCategory } from '@aurora/event-schema';

/**
 * Drift guard: the error_category CHECK constraint must list exactly the
 * current @aurora/event-schema public constants. If event-schema adds or
 * removes a category, this test fails explicitly instead of silently drifting.
 */
describe('error_category protocol drift guard', () => {
  it('migration CHECK matches the event-schema ErrorCategory public constants exactly', async () => {
    const migration = await readFile(
      new URL('../migrations/1722500000003_error-event-occurrences.ts', import.meta.url),
      'utf8',
    );
    const checkMatch = /error_category IN \('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'\)/.exec(
      migration,
    );
    expect(checkMatch, 'category CHECK must list three values').not.toBeNull();
    const checkValues = checkMatch?.slice(1).sort() ?? [];
    const publicValues = Object.values(ErrorCategory).sort();
    expect(checkValues).toEqual(publicValues);
  });

  it('derives error_category from the parsed envelope, not a copied local enum', async () => {
    const inputSource = await readFile(
      new URL('../src/error-occurrence-input.ts', import.meta.url),
      'utf8',
    );
    // The mapping must come from the parsed ErrorEventEnvelope body category.
    expect(inputSource).toContain('envelope.body.category');
    // It must import from the event-schema root entry, not a private path.
    expect(inputSource).toContain("from '@aurora/event-schema'");
    expect(inputSource).not.toMatch(/@aurora\/event-schema\/src/);
    // No local literal union of the three categories may exist in source.
    const allSource = (
      await Promise.all([
        readFile(new URL('../src/error-occurrence-input.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/error-occurrence-types.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/error-occurrence-repository.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/errors.ts', import.meta.url), 'utf8'),
      ])
    ).join('\n');
    expect(allSource).not.toMatch(/'javascript'\s*\|\s*'unhandled_rejection'\s*\|\s*'resource'/);
  });
});
