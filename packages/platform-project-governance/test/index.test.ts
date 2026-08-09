import { describe, expect, it } from 'vitest';
import {
  PLATFORM_PROJECT_GOVERNANCE_PACKAGE,
  PLATFORM_PROJECT_GOVERNANCE_VERSION,
} from '../src/index.js';

describe('platform-project-governance package root', () => {
  it('exposes the stable package marker', () => {
    expect(PLATFORM_PROJECT_GOVERNANCE_PACKAGE).toBe('@aurora/platform-project-governance');
    expect(PLATFORM_PROJECT_GOVERNANCE_VERSION).toBe('0.0.0');
  });
});
