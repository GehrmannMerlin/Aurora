import { describe, expect, it } from 'vitest';
import {
  countOrganizationOwners,
  isUniqueOrganizationOwner,
  listAccountOrganizations,
} from '../src/index.js';

/**
 * The ownership read functions are pure SQL over a real PostgreSQL database, so
 * their behavior is exercised by the integration suite (test/integration/
 * ownership.test.ts). This no-DB smoke test only guards the public export
 * surface so an accidental export removal fails the fast unit run too.
 */
describe('platform-organization ownership read repository exports', () => {
  it('exposes the ownership read functions from the package root', () => {
    expect(typeof listAccountOrganizations).toBe('function');
    expect(typeof countOrganizationOwners).toBe('function');
    expect(typeof isUniqueOrganizationOwner).toBe('function');
  });
});
