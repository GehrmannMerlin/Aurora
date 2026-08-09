import { describe, expect, it } from 'vitest';
import { PLATFORM_AUDIT_PACKAGE, PLATFORM_AUDIT_VERSION } from '../src/index.js';

describe('platform-audit package root', () => {
  it('exposes the stable package marker', () => {
    expect(PLATFORM_AUDIT_PACKAGE).toBe('@aurora/platform-audit');
    expect(PLATFORM_AUDIT_VERSION).toBe('0.0.0');
  });
});
