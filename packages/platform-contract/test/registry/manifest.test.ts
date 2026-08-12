import { describe, expect, it } from 'vitest';
import {
  validateManifest,
  OPERATION_MANIFEST,
  type CoverageKind,
} from '../../src/registry/manifest.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from '../../src/registry/operations.js';
import { ROUTE_TARGET_IDS, type RouteTargetId } from '../../src/common/navigation.js';

describe('operation registry and manifest', () => {
  it('exposes the stable operations in registry order', () => {
    expect(PLATFORM_OPERATIONS.map((o) => o.operationId)).toEqual([
      'identityGetSession',
      'navigationGetContext',
      'identityRegister',
      'identityConfirmEmailVerification',
      'identityLogin',
      'identityLogout',
      'identityRequestPasswordReset',
      'identityConfirmPasswordReset',
      'identityChangePassword',
      'identityDeleteAccountPreflight',
      'identityRequestAccountDeletion',
      'identityDeleteAccountIntentLink',
      'identityDeleteAccount',
      'identityCancelAccountDeletionIntentLink',
      'identityCancelAccountDeletion',
      'organizationAcceptInvitation',
      'organizationListProjects',
      'organizationCreateProject',
      'organizationListMembers',
      'organizationInviteMember',
      'organizationRevokeInvitation',
      'organizationResendInvitation',
      'organizationChangeRole',
      'organizationRemoveMember',
      'organizationTransferOwnership',
      'organizationUpdateTimezone',
      'projectGovernanceListTrash',
      'projectGovernanceRestoreProject',
      'credentialsListPrivateTokens',
      'credentialsCreatePrivateToken',
      'credentialsRevokePrivateToken',
      'auditListSecurityAudit',
      'requestsListEndpoints',
      'diagnosticsGetDataStatus',
      'performanceListPages',
      'usageGetSummary',
      'issuesUpdateState',
      'issuesUpdateAssignee',
      'issuesUpdatePriority',
      'issuesCreateNote',
      'issuesDeleteNote',
      'issuesMerge',
      'issuesBatchUpdate',
      'issuesListIssues',
      'issuesGetIssueDetail',
      'alertsGetCapability',
      'alertsListRulesAndInstances',
      'alertsCreateRule',
      'alertsUpdateRule',
      'alertsGetInstanceDetail',
      'releasesListReleases',
      'sourceMapsListFiles',
      'sourceMapsUpload',
      'sourceMapsReplace',
      'sourceMapsReparse',
      'accessListEffectiveMembers',
      'accessGrantProjectMembership',
      'accessChangeProjectRole',
      'accessRemoveProjectMembership',
      'credentialsListClientKeys',
      'credentialsCreateClientKey',
      'credentialsDisableClientKey',
      'credentialsEnableClientKey',
      'credentialsRevokeClientKey',
      'settingsGetProject',
      'settingsUpdateProject',
      'settingsListEnvironments',
      'settingsCreateEnvironment',
      'lifecycleArchiveProject',
      'lifecycleRestoreProject',
      'lifecycleMoveToTrash',
      'notificationsListAndUnread',
      'notificationsMarkRead',
    ]);
  });

  it('registers blocked downstream operations without schemas', () => {
    expect(BLOCKED_OPERATIONS.map((op) => op.operationId)).toEqual([
      'onboardingGetProgress',
      'overviewGetProjectStatus',
      'policySetPlatformDefault',
    ]);
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
      'project.release-detail': 'stable',
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
      'auth.register': 'stable',
      'auth.verify-email': 'unavailable',
      'auth.verify-email-confirm': 'stable',
      'auth.login': 'stable',
      'auth.forgot-password': 'stable',
      'auth.reset-password': 'stable',
      'invitation.accept': 'stable',
      'account.security': 'stable',
      'account.deletion-cancel': 'unavailable',
      'account.deletion-confirm': 'unavailable',
      'workspace.home': 'stable',
      'organization.project-create': 'stable',
      'organization.members': 'stable',
      'organization.settings': 'stable',
      'organization.usage': 'stable',
      'organization.tokens': 'stable',
      'organization.audit': 'stable',
      'organization.trash': 'stable',
      'project.onboarding': 'blocked',
      'project.overview': 'blocked',
      'project.issues': 'stable',
      'project.issue-detail': 'stable',
      'project.requests': 'stable',
      'project.performance': 'stable',
      'project.data-status': 'stable',
      'project.releases': 'stable',
      'project.release-detail': 'unavailable',
      'project.source-maps': 'stable',
      'project.alerts': 'stable',
      'project.alert-rule-create': 'stable',
      'project.alert-rule-edit': 'stable',
      'project.alert-instance-detail': 'stable',
      'project.access': 'stable',
      'project.client-keys': 'stable',
      'project.settings': 'stable',
      'project.lifecycle': 'stable',
      'account.notifications': 'stable',
      'platform.resource-policies': 'unavailable',
    };
    expect(Object.keys(expected)).toHaveLength(ROUTE_TARGET_IDS.length);
    for (const rt of ROUTE_TARGET_IDS) {
      expect(OPERATION_MANIFEST.routeTargetCoverage[rt], rt).toBe(expected[rt]);
    }
  });
});
