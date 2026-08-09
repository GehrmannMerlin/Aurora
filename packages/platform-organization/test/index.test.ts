import { describe, expect, it } from 'vitest';
import { PLATFORM_ORGANIZATION_PACKAGE, PLATFORM_ORGANIZATION_VERSION } from '../src/index.js';

describe('platform-organization package root', () => {
  it('exposes the stable package marker', () => {
    expect(PLATFORM_ORGANIZATION_PACKAGE).toBe('@aurora/platform-organization');
    expect(PLATFORM_ORGANIZATION_VERSION).toBe('0.0.0');
  });
});
