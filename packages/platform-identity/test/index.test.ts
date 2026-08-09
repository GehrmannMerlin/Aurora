import { describe, expect, it } from 'vitest';
import { PLATFORM_IDENTITY_PACKAGE, PLATFORM_IDENTITY_VERSION } from '../src/index.js';

describe('platform-identity package root', () => {
  it('exposes the stable package marker', () => {
    expect(PLATFORM_IDENTITY_PACKAGE).toBe('@aurora/platform-identity');
    expect(PLATFORM_IDENTITY_VERSION).toBe('0.0.0');
  });
});
