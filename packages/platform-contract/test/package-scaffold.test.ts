import { describe, expect, it } from 'vitest';
import { PLATFORM_CONTRACT_VERSION } from '../src/index.js';

describe('platform-contract scaffold', () => {
  it('exposes a stable version constant', () => {
    expect(PLATFORM_CONTRACT_VERSION).toBe('v1');
  });
});
