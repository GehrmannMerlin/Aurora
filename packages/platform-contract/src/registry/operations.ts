import type { RouteTargetId } from '../common/navigation.js';
import type { PaginationModel } from '../common/pagination.js';
import type { SchemaDef } from '../common/schema.js';
import { identityGetSessionResponse, OPERATION_ID_SESSION } from '../identity/session.js';
import {
  navigationGetContextResponse,
  OPERATION_ID_NAVIGATION,
} from '../identity/navigation-context.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type AuthLevel = 'public' | 'intent' | 'session' | 'recent-verification';

export interface OperationDef {
  readonly operationId: string;
  readonly domain: string;
  readonly authLevel: AuthLevel;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly request?: {
    readonly pathParams?: SchemaDef;
    readonly query?: SchemaDef;
    readonly body?: SchemaDef;
    readonly idempotency?: boolean;
    readonly csrf?: boolean;
    readonly versioned?: boolean;
  };
  readonly responses: Readonly<Record<number, SchemaDef>>;
  readonly errorCodes: readonly string[];
  readonly page?: RouteTargetId;
  readonly pagination?: PaginationModel;
  readonly tags: readonly string[];
}

export const PLATFORM_OPERATIONS: readonly OperationDef[] = [
  {
    operationId: OPERATION_ID_SESSION,
    domain: 'identity',
    authLevel: 'public',
    method: 'GET',
    path: '/api/platform/v1/session',
    summary: 'Resolve the current account session projection and CSRF token',
    responses: { 200: identityGetSessionResponse },
    errorCodes: ['authentication', 'authority_unavailable'],
    page: 'workspace.home',
    tags: ['identity', 'session'],
  },
  {
    operationId: OPERATION_ID_NAVIGATION,
    domain: 'identity',
    authLevel: 'session',
    method: 'GET',
    path: '/api/platform/v1/navigation/context',
    summary: 'Resolve the authorized navigation context for the current scope',
    responses: { 200: navigationGetContextResponse },
    errorCodes: ['authentication', 'authorization', 'authority_unavailable'],
    page: 'workspace.home',
    tags: ['identity', 'navigation'],
  },
];

export interface BlockedOperation {
  readonly operationId: string;
  readonly domain: string;
  readonly reason: string;
}

export const BLOCKED_OPERATIONS: readonly BlockedOperation[] = [
  {
    operationId: 'identityRegister',
    domain: 'identity',
    reason: 'A1 auth backend not formalized (G10)',
  },
  {
    operationId: 'identityConfirmEmailVerification',
    domain: 'identity',
    reason: 'A1 verify backend not formalized (G10)',
  },
  {
    operationId: 'identityLogin',
    domain: 'identity',
    reason: 'A2 login backend not formalized (G10)',
  },
  {
    operationId: 'identityLogout',
    domain: 'identity',
    reason: 'A2 session backend not formalized (G10)',
  },
  {
    operationId: 'identityRequestPasswordReset',
    domain: 'identity',
    reason: 'A3 reset backend not formalized (G10)',
  },
  {
    operationId: 'identityConfirmPasswordReset',
    domain: 'identity',
    reason: 'A3 reset backend not formalized (G10)',
  },
  {
    operationId: 'identityChangePassword',
    domain: 'identity',
    reason: 'A5 security backend not formalized (G10)',
  },
  {
    operationId: 'identityDeleteAccountPreflight',
    domain: 'identity',
    reason: 'A5 deletion backend not formalized (G10)',
  },
  {
    operationId: 'identityDeleteAccount',
    domain: 'identity',
    reason: 'A5 deletion orchestration not formalized (G10/SEC-01)',
  },
  {
    operationId: 'organizationAcceptInvitation',
    domain: 'organization',
    reason: 'A4 invitation backend not formalized (G10)',
  },
  {
    operationId: 'organizationListProjects',
    domain: 'organization',
    reason: 'B1 workspace backend not formalized (G10)',
  },
  {
    operationId: 'organizationCreateProject',
    domain: 'organization',
    reason: 'B2 project-governance model not formalized (G10)',
  },
  {
    operationId: 'organizationListMembers',
    domain: 'organization',
    reason: 'B3 membership model not formalized (G10)',
  },
  {
    operationId: 'organizationInviteMember',
    domain: 'organization',
    reason: 'B3 invitation model not formalized (G10)',
  },
  {
    operationId: 'organizationUpdateTimezone',
    domain: 'organization',
    reason: 'B4 org settings model not formalized (G10)',
  },
  {
    operationId: 'usageGetSummary',
    domain: 'usage-and-policy',
    reason: 'B5 usage module absent (G10/G11)',
  },
  {
    operationId: 'credentialsListPrivateTokens',
    domain: 'credentials',
    reason: 'B6 credential model not formalized (G10)',
  },
  {
    operationId: 'credentialsCreatePrivateToken',
    domain: 'credentials',
    reason: 'B6 one-time secret delivery not formalized (G10)',
  },
  {
    operationId: 'auditListSecurityAudit',
    domain: 'audit',
    reason: 'B7 audit model not formalized (G10)',
  },
  {
    operationId: 'projectGovernanceListTrash',
    domain: 'project-governance',
    reason: 'B8 recycle-bin model not formalized (G10)',
  },
  {
    operationId: 'projectGovernanceRestoreProject',
    domain: 'project-governance',
    reason: 'B8 restore backend not formalized (G10)',
  },
  {
    operationId: 'onboardingGetProgress',
    domain: 'project-governance',
    reason: 'C1 onboarding model not formalized (G11)',
  },
  {
    operationId: 'overviewGetProjectStatus',
    domain: 'issues-and-alerts',
    reason: 'C2 overview Query not formalized (G11)',
  },
  {
    operationId: 'issuesListIssues',
    domain: 'issues-and-alerts',
    reason: 'C3 processing-store Query contract absent (G11)',
  },
  {
    operationId: 'issuesGetIssueDetail',
    domain: 'issues-and-alerts',
    reason: 'C4 processing-store Query contract absent (G11)',
  },
  {
    operationId: 'requestsListEndpoints',
    domain: 'monitoring-projections',
    reason: 'C5 request metric Query absent (G11)',
  },
  {
    operationId: 'performanceListPages',
    domain: 'monitoring-projections',
    reason: 'C6 performance metric Query absent (G11)',
  },
  {
    operationId: 'diagnosticsGetDataStatus',
    domain: 'monitoring-projections',
    reason: 'C7 diagnostics Query absent (G11)',
  },
  {
    operationId: 'releasesListReleases',
    domain: 'releases',
    reason: 'C8 releases model not formalized (G12)',
  },
  {
    operationId: 'sourceMapsListFiles',
    domain: 'releases',
    reason: 'C9 Source Map/object store not formalized (G12)',
  },
  {
    operationId: 'alertsListRulesAndInstances',
    domain: 'issues-and-alerts',
    reason: 'C10 alert model not formalized (G12)',
  },
  {
    operationId: 'alertsCreateRule',
    domain: 'issues-and-alerts',
    reason: 'C11 alert rule model not formalized (G12)',
  },
  {
    operationId: 'alertsGetInstanceDetail',
    domain: 'issues-and-alerts',
    reason: 'C12 alert instance Query absent (G12)',
  },
  {
    operationId: 'accessListEffectiveMembers',
    domain: 'project-governance',
    reason: 'C13 access projection not formalized (G12)',
  },
  {
    operationId: 'credentialsListClientKeys',
    domain: 'credentials',
    reason: 'C14 client-key management not formalized (G12)',
  },
  {
    operationId: 'settingsGetProject',
    domain: 'project-governance',
    reason: 'C15 settings model not formalized (G12)',
  },
  {
    operationId: 'lifecycleArchiveProject',
    domain: 'project-governance',
    reason: 'C16 lifecycle model not formalized (G12)',
  },
  {
    operationId: 'notificationsListAndUnread',
    domain: 'issues-and-alerts',
    reason: 'D1 notifications backend not formalized (G13)',
  },
  {
    operationId: 'policySetPlatformDefault',
    domain: 'usage-and-policy',
    reason: 'D2 PlatformAdmin authority not approved (G13)',
  },
];
