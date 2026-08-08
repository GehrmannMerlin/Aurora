import { ROUTE_TARGET_IDS, type RouteTargetId } from '../common/navigation.js';
import { BLOCKED_OPERATIONS, PLATFORM_OPERATIONS } from './operations.js';

export type CoverageKind = 'stable' | 'blocked' | 'unavailable';

export interface OperationManifest {
  readonly stable: readonly string[];
  readonly blocked: Readonly<Record<string, string>>;
  readonly routeTargetCoverage: Readonly<Record<RouteTargetId, CoverageKind>>;
}

const operationIdPattern = /^[a-z][A-Za-z0-9]+$/;

function buildRouteTargetCoverage(): Record<RouteTargetId, CoverageKind> {
  // fromEntries erases the tuple keys; the cast is sound because the object is built
  // from ROUTE_TARGET_IDS itself, so it contains exactly the RouteTargetId key set.
  const coverage = Object.fromEntries(ROUTE_TARGET_IDS.map((rt) => [rt, 'unavailable'])) as Record<
    RouteTargetId,
    CoverageKind
  >;
  for (const op of PLATFORM_OPERATIONS) {
    if (op.page) coverage[op.page] = 'stable';
  }
  for (const op of BLOCKED_OPERATIONS) {
    const page = pageForOperation(op.operationId);
    // D2 gate: platform.resource-policies is the PlatformAdmin page; PlatformAdmin authority is
    // not approved (G13), so the page stays 'unavailable' even though policySetPlatformDefault is
    // registered as metadata-only blocked. Its pageForOperation entry is retained for tracing.
    if (page && coverage[page] === 'unavailable' && page !== 'platform.resource-policies') {
      coverage[page] = 'blocked';
    }
  }
  return coverage;
}

function pageForOperation(operationId: string): RouteTargetId | undefined {
  const map: Readonly<Record<string, RouteTargetId>> = {
    identityRegister: 'auth.register',
    identityConfirmEmailVerification: 'auth.verify-email-confirm',
    identityLogin: 'auth.login',
    identityRequestPasswordReset: 'auth.forgot-password',
    identityConfirmPasswordReset: 'auth.reset-password',
    identityChangePassword: 'account.security',
    identityDeleteAccountPreflight: 'account.security',
    identityDeleteAccount: 'account.security',
    organizationAcceptInvitation: 'invitation.accept',
    organizationListProjects: 'workspace.home',
    organizationCreateProject: 'organization.project-create',
    organizationListMembers: 'organization.members',
    organizationInviteMember: 'organization.members',
    organizationUpdateTimezone: 'organization.settings',
    usageGetSummary: 'organization.usage',
    credentialsListPrivateTokens: 'organization.tokens',
    credentialsCreatePrivateToken: 'organization.tokens',
    auditListSecurityAudit: 'organization.audit',
    projectGovernanceListTrash: 'organization.trash',
    projectGovernanceRestoreProject: 'organization.trash',
    onboardingGetProgress: 'project.onboarding',
    overviewGetProjectStatus: 'project.overview',
    issuesListIssues: 'project.issues',
    issuesGetIssueDetail: 'project.issue-detail',
    requestsListEndpoints: 'project.requests',
    performanceListPages: 'project.performance',
    diagnosticsGetDataStatus: 'project.data-status',
    releasesListReleases: 'project.releases',
    sourceMapsListFiles: 'project.source-maps',
    alertsListRulesAndInstances: 'project.alerts',
    alertsCreateRule: 'project.alert-rule-create',
    alertsGetInstanceDetail: 'project.alert-instance-detail',
    accessListEffectiveMembers: 'project.access',
    credentialsListClientKeys: 'project.client-keys',
    settingsGetProject: 'project.settings',
    lifecycleArchiveProject: 'project.lifecycle',
    notificationsListAndUnread: 'account.notifications',
    policySetPlatformDefault: 'platform.resource-policies',
  };
  return map[operationId];
}

export const OPERATION_MANIFEST: OperationManifest = {
  stable: PLATFORM_OPERATIONS.map((op) => op.operationId),
  blocked: Object.fromEntries(BLOCKED_OPERATIONS.map((op) => [op.operationId, op.reason])),
  routeTargetCoverage: buildRouteTargetCoverage(),
};

export function validateManifest(): void {
  const seen = new Set<string>();
  for (const op of PLATFORM_OPERATIONS) {
    if (seen.has(op.operationId)) throw new Error(`duplicate operationId: ${op.operationId}`);
    seen.add(op.operationId);
    if (!operationIdPattern.test(op.operationId))
      throw new Error(`invalid operationId format: ${op.operationId}`);
  }
  for (const op of BLOCKED_OPERATIONS) {
    if (seen.has(op.operationId))
      throw new Error(`blocked op collides with stable op: ${op.operationId}`);
    seen.add(op.operationId);
    if (!operationIdPattern.test(op.operationId))
      throw new Error(`invalid blocked operationId: ${op.operationId}`);
  }
  for (const rt of ROUTE_TARGET_IDS) {
    // routeTargetCoverage is a full Record<RouteTargetId, CoverageKind>, so a missing key is
    // only possible through a data/construction divergence; guard it explicitly at runtime.
    if (!Object.hasOwn(OPERATION_MANIFEST.routeTargetCoverage, rt)) {
      throw new Error(`route target not covered: ${rt}`);
    }
  }
}
