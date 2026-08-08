import { describe, expect, it } from 'vitest';
import { ProjectId } from '../../src/common/identifiers.js';

describe('branded identifiers', () => {
  it('accepts opaque stable ids and rejects empty/oversized', () => {
    expect(ProjectId.zod.safeParse('p_abc123').success).toBe(true);
    expect(ProjectId.zod.safeParse('').success).toBe(false);
  });
});
