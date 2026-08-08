import { describe, expect, it } from 'vitest';
import {
  validateManifest,
  OPERATION_MANIFEST,
  type CoverageKind,
} from '../../src/registry/manifest.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from '../../src/registry/operations.js';
import { ROUTE_TARGET_IDS, type RouteTargetId } from '../../src/common/navigation.js';

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

  it('throws when a blocked operation carries a schema', () => {
    expect(() => {
      validateManifest({
        blockedOps: [
          ...BLOCKED_OPERATIONS,
          {
            operationId: 'registryFakeOp',
            domain: 'test',
            reason: 'injected',
            responses: { 200: {} },
          },
        ],
      });
    }).toThrow(/blocked op carries a schema/);
  });

  it('throws when a blocked operation carries a request schema', () => {
    expect(() => {
      validateManifest({
        blockedOps: [
          ...BLOCKED_OPERATIONS,
          {
            operationId: 'registryFakeRequestOp',
            domain: 'test',
            reason: 'injected',
            request: { body: {} },
          },
        ],
      });
    }).toThrow(/blocked op carries a schema/);
  });

  it('throws when a route target is marked stable without an emittable operation', () => {
    const bad: Readonly<Record<RouteTargetId, CoverageKind>> = {
      ...OPERATION_MANIFEST.routeTargetCoverage,
      'account.security': 'stable',
    };
    expect(() => {
      validateManifest({ coverage: bad });
    }).toThrow(/marked stable without/);
  });

  it('throws when a route target is missing from coverage', () => {
    const partial: Partial<Record<RouteTargetId, CoverageKind>> = {
      ...OPERATION_MANIFEST.routeTargetCoverage,
    };
    delete partial['auth.register'];
    expect(() => {
      validateManifest({
        coverage: partial as unknown as Readonly<Record<RouteTargetId, CoverageKind>>,
      });
    }).toThrow(/route target not covered/);
  });

  it('freezes the exact route target coverage kind for every route target', () => {
    const expected: Readonly<Record<RouteTargetId, CoverageKind>> = {
      'auth.register': 'blocked',
      'auth.verify-email': 'unavailable',
      'auth.verify-email-confirm': 'blocked',
      'auth.login': 'blocked',
      'auth.forgot-password': 'blocked',
      'auth.reset-password': 'blocked',
      'invitation.accept': 'blocked',
      'account.security': 'blocked',
      'workspace.home': 'stable',
      'organization.project-create': 'blocked',
      'organization.members': 'blocked',
      'organization.settings': 'blocked',
      'organization.usage': 'blocked',
      'organization.tokens': 'blocked',
      'organization.audit': 'blocked',
      'organization.trash': 'blocked',
      'project.onboarding': 'blocked',
      'project.overview': 'blocked',
      'project.issues': 'blocked',
      'project.issue-detail': 'blocked',
      'project.requests': 'blocked',
      'project.performance': 'blocked',
      'project.data-status': 'blocked',
      'project.releases': 'blocked',
      'project.release-detail': 'unavailable',
      'project.source-maps': 'blocked',
      'project.alerts': 'blocked',
      'project.alert-rule-create': 'blocked',
      'project.alert-rule-edit': 'unavailable',
      'project.alert-instance-detail': 'blocked',
      'project.access': 'blocked',
      'project.client-keys': 'blocked',
      'project.settings': 'blocked',
      'project.lifecycle': 'blocked',
      'account.notifications': 'blocked',
      'platform.resource-policies': 'unavailable',
    };
    expect(Object.keys(expected)).toHaveLength(ROUTE_TARGET_IDS.length);
    for (const rt of ROUTE_TARGET_IDS) {
      expect(OPERATION_MANIFEST.routeTargetCoverage[rt], rt).toBe(expected[rt]);
    }
  });
});
