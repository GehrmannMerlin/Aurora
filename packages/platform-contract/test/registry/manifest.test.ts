import { describe, expect, it } from 'vitest';
import { validateManifest, OPERATION_MANIFEST } from '../../src/registry/manifest.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from '../../src/registry/operations.js';
import { ROUTE_TARGET_IDS } from '../../src/common/navigation.js';

describe('operation registry and manifest', () => {
  it('exposes two stable foundation operations', () => {
    expect(PLATFORM_OPERATIONS.map((o) => o.operationId)).toEqual([
      'identityGetSession',
      'navigationGetContext',
    ]);
  });

  it('registers blocked downstream operations without schemas', () => {
    expect(BLOCKED_OPERATIONS.length).toBeGreaterThan(30);
    for (const op of BLOCKED_OPERATIONS) {
      expect(op.reason.length).toBeGreaterThan(10);
      expect('responses' in op).toBe(false);
    }
  });

  it('passes manifest validation (uniqueness, coverage, no blocked-as-stable)', () => {
    expect(() => {
      validateManifest();
    }).not.toThrow();
  });

  it('covers every route target via stable or blocked operations or unavailable', () => {
    const covered = Object.keys(OPERATION_MANIFEST.routeTargetCoverage);
    for (const rt of ROUTE_TARGET_IDS) {
      expect(covered).toContain(rt);
      expect(['stable', 'blocked', 'unavailable']).toContain(
        OPERATION_MANIFEST.routeTargetCoverage[rt],
      );
    }
  });

  it('marks platform.resource-policies unavailable (D2 gate)', () => {
    expect(OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies']).toBe(
      'unavailable',
    );
  });
});
