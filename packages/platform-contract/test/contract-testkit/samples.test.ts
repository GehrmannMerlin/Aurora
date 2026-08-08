import { describe, expect, it } from 'vitest';
import { identityGetSessionResponse } from '../../src/identity/session.js';
import { navigationGetContextResponse } from '../../src/identity/navigation-context.js';
import { auroraProblem } from '../../src/common/problem-details.js';
import {
  validSessionSamples,
  invalidSessionSamples,
  validNavigationSamples,
  invalidNavigationSamples,
  validProblemSamples,
} from '../../src/contract-testkit/index.js';

describe('contract testkit', () => {
  it('valid samples pass their schemas', () => {
    for (const s of validSessionSamples)
      expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validNavigationSamples)
      expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validProblemSamples) expect(auroraProblem.zod.safeParse(s).success).toBe(true);
  });

  it('invalid samples fail their schemas', () => {
    for (const s of invalidSessionSamples)
      expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(false);
    for (const s of invalidNavigationSamples)
      expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(false);
  });

  it('samples contain no secrets', () => {
    const all = JSON.stringify([...validSessionSamples, ...validNavigationSamples]);
    expect(all).not.toMatch(/aurora_ingest_|Bearer |secret|password|sessionId/i);
  });
});
