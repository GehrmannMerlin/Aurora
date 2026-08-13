import { describe, expect, it } from 'vitest';
import { ROUTE_TARGET_IDS, type RouteTargetId } from '@aurora/platform-contract';
import {
  ORG_SIDEBAR_ENTRIES,
  PROJECT_SIDEBAR_ENTRIES,
} from '../../src/contracts/sidebar-entries.js';
import {
  ROUTE_BY_ID,
  ROUTE_REGISTRY,
  resolveRouteTarget,
} from '../../src/contracts/route-registry.js';

describe('RouteTarget registry', () => {
  it('declares exactly the 37 frozen route targets', () => {
    expect(ROUTE_REGISTRY.map((entry) => entry.routeId).sort()).toEqual(
      [...ROUTE_TARGET_IDS].sort(),
    );
  });

  it('gives every entry a path template, scope, label and lazy loader', () => {
    for (const entry of ROUTE_REGISTRY) {
      expect(entry.path).toMatch(/^\//);
      expect(['public', 'account', 'workspace', 'organization', 'project', 'platform']).toContain(
        entry.scope,
      );
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.lazy).toBe('function');
    }
  });

  it('resolves a project target with params and query', () => {
    const result = resolveRouteTarget({
      routeId: 'project.overview',
      pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' },
      query: {},
    });
    expect(result.path).toBe('/organizations/org_test_1/projects/prj_test_1/overview');
  });

  it('serializes a non-empty query string onto the resolved path', () => {
    const result = resolveRouteTarget({
      routeId: 'project.overview',
      pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' },
      query: { tab: 'events' },
    });
    expect(result.path).toBe('/organizations/org_test_1/projects/prj_test_1/overview?tab=events');
  });

  it('interpolates path-param values literally (no ECMAScript replacement grammar)', () => {
    // A string replacement would corrupt `$1`/`$&`/`$'` sequences; the value
    // must be percent-encoded once and inserted verbatim.
    const result = resolveRouteTarget({
      routeId: 'organization.members',
      pathParams: { organizationId: "org$1&$&$'" },
      query: {},
    });
    expect(result.path).toBe(`/organizations/${encodeURIComponent("org$1&$&$'")}/members`);
  });

  it('rejects invalid params and unknown targets safely', () => {
    expect(
      resolveRouteTarget({ routeId: 'project.overview', pathParams: {}, query: {} }).error,
    ).toBe('invalid-params');
    expect(
      resolveRouteTarget({ routeId: 'made.up' as RouteTargetId, pathParams: {}, query: {} }).error,
    ).toBe('unknown-target');
  });

  it('keeps the approved sidebar entry lists within the registry', () => {
    for (const routeId of [...ORG_SIDEBAR_ENTRIES, ...PROJECT_SIDEBAR_ENTRIES]) {
      expect(ROUTE_BY_ID.get(routeId)?.menu).toBe(true);
    }
  });

  it('marks every non-shell business target as unavailable (no fake content)', () => {
    // PLT-03 replaced these unavailable stubs with real auth/account views.
    // PLT-04 7A adds the real B1 workspace home and the honest B5 usage-unavailable page.
    // PLT-04 7B adds the real B2 create-project, B3 members and B4 settings pages.
    // PLT-04 7C adds the real B6 tokens, B7 audit and B8 trash pages.
    const realViewRoutes = new Set([
      'auth.register',
      'auth.verify-email',
      'auth.verify-email-confirm',
      'auth.login',
      'auth.forgot-password',
      'auth.reset-password',
      'invitation.accept',
      'account.security',
      'account.deletion-cancel',
      'account.deletion-confirm',
      // PLT-09 replaces the account.notifications stub with the real D1 view.
      'account.notifications',
      'organization.usage',
      'organization.project-create',
      'organization.members',
      'organization.settings',
      'organization.tokens',
      'organization.audit',
      'organization.trash',
      // PLT-05 replaces these unavailable stubs with real monitoring views.
      'project.onboarding',
      'project.overview',
      'project.data-status',
      // PLT-06 replaces these unavailable stubs with real workspace views.
      'project.issues',
      'project.issue-detail',
      'project.requests',
      'project.performance',
      // PLT-07 replaces these unavailable stubs with real release/source-map/alert views.
      'project.releases',
      'project.release-detail',
      'project.source-maps',
      'project.alerts',
      'project.alert-rule-create',
      'project.alert-rule-edit',
      'project.alert-instance-detail',
      // PLT-08 replaces these unavailable stubs with real access/settings/lifecycle views.
      'project.access',
      'project.client-keys',
      'project.settings',
      'project.lifecycle',
      // PLT-10c replaces the platform.resource-policies stub with the real D2 view.
      'platform.resource-policies',
    ]);
    for (const entry of ROUTE_REGISTRY) {
      if (entry.routeId === 'workspace.home') continue;
      if (realViewRoutes.has(entry.routeId)) {
        expect(entry.unavailableReason, entry.routeId).toBeNull();
        continue;
      }
      expect(entry.unavailableReason).not.toBeNull();
      expect(entry.unavailableReason).toMatch(
        /^(capability-not-provided|dependency-unavailable|permission-unavailable)$/,
      );
    }
  });

  it('keeps the frozen id list verbatim', () => {
    expect(ROUTE_REGISTRY.map((entry) => entry.routeId)).toEqual(ROUTE_TARGET_IDS);
  });

  it('resolves the PLT-07 release/source-map/alert routes with real lazy views', async () => {
    const cases: readonly {
      routeId: RouteTargetId;
      pathParams: Record<string, string>;
      parent?: RouteTargetId;
    }[] = [
      {
        routeId: 'project.releases',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
      {
        routeId: 'project.release-detail',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1', releaseId: 'release_1' },
        parent: 'project.releases',
      },
      {
        routeId: 'project.source-maps',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1', releaseId: 'release_1' },
        parent: 'project.release-detail',
      },
      {
        routeId: 'project.alerts',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
      {
        routeId: 'project.alert-rule-create',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
        parent: 'project.alerts',
      },
      {
        routeId: 'project.alert-rule-edit',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1', ruleId: 'rule_1' },
        parent: 'project.alerts',
      },
      {
        routeId: 'project.alert-instance-detail',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1', instanceId: 'instance_1' },
        parent: 'project.alerts',
      },
    ];
    for (const c of cases) {
      const entry = ROUTE_BY_ID.get(c.routeId);
      expect(entry, c.routeId).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.unavailableReason, c.routeId).toBeNull();
      if (c.parent !== undefined) expect(entry.parent, c.routeId).toBe(c.parent);
      const resolved = resolveRouteTarget({
        routeId: c.routeId,
        pathParams: c.pathParams,
        query: {},
      });
      expect(resolved.path, c.routeId).toBeDefined();
      const component = await entry.lazy();
      expect(typeof component).not.toBe('undefined');
    }
  });

  it('resolves the PLT-08 access/client-keys/settings/lifecycle routes with real lazy views', async () => {
    const cases: readonly { routeId: RouteTargetId; pathParams: Record<string, string> }[] = [
      {
        routeId: 'project.access',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
      {
        routeId: 'project.client-keys',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
      {
        routeId: 'project.settings',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
      {
        routeId: 'project.lifecycle',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      },
    ];
    for (const c of cases) {
      const entry = ROUTE_BY_ID.get(c.routeId);
      expect(entry, c.routeId).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.unavailableReason, c.routeId).toBeNull();
      const resolved = resolveRouteTarget({
        routeId: c.routeId,
        pathParams: c.pathParams,
        query: {},
      });
      expect(resolved.path, c.routeId).toBeDefined();
      const component = await entry.lazy();
      expect(typeof component).not.toBe('undefined');
    }
  });
});
