import { describe, expect, it } from 'vitest';
import { PLATFORM_CREDENTIALS_PACKAGE, PLATFORM_CREDENTIALS_VERSION } from '../src/index.js';

describe('platform-credentials package root', () => {
  it('exposes the stable package marker', () => {
    expect(PLATFORM_CREDENTIALS_PACKAGE).toBe('@aurora/platform-credentials');
    expect(PLATFORM_CREDENTIALS_VERSION).toBe('0.0.0');
  });
});
