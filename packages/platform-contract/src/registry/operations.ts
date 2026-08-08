import type { RouteTargetId } from '../common/navigation.js';
import type { PaginationModel } from '../common/pagination.js';
import type { SchemaDef } from '../common/schema.js';
import { identityGetSessionResponse, OPERATION_ID_SESSION } from '../identity/session.js';
import {
  navigationGetContextResponse,
  OPERATION_ID_NAVIGATION,
} from '../identity/navigation-context.js';
import {
  identityRegisterRequest,
  identityRegisterResponse,
  OPERATION_ID_REGISTER,
} from '../identity/register.js';
import {
  identityLoginRequest,
  identityLoginResponse,
  identityLogoutResponse,
  OPERATION_ID_LOGIN,
  OPERATION_ID_LOGOUT,
} from '../identity/login.js';
import {
  identityChangePasswordRequest,
  identityChangePasswordResponse,
  identityConfirmPasswordResetRequest,
  identityConfirmPasswordResetResponse,
  identityRequestPasswordResetRequest,
  identityRequestPasswordResetResponse,
  OPERATION_ID_CHANGE_PASSWORD,
  OPERATION_ID_CONFIRM_PASSWORD_RESET,
  OPERATION_ID_REQUEST_PASSWORD_RESET,
} from '../identity/password.js';
import {
  identityConfirmEmailVerificationRequest,
  identityConfirmEmailVerificationResponse,
  OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
} from '../identity/email-verification.js';
import {
  OPERATION_ID_ACCEPT_INVITATION,
  organizationAcceptInvitationRequest,
  organizationAcceptInvitationResponse,
} from '../identity/invitation.js';

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
  {
    operationId: OPERATION_ID_REGISTER,
    domain: 'identity',
    authLevel: 'public',
    method: 'POST',
    path: '/api/platform/v1/auth/register',
    summary: 'Register a new account and create the personal workspace',
    request: { body: identityRegisterRequest, idempotency: true, csrf: false },
    responses: { 200: identityRegisterResponse },
    errorCodes: [
      'structural_error',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'auth.register',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
    domain: 'identity',
    authLevel: 'intent',
    method: 'POST',
    path: '/api/platform/v1/auth/email/confirm',
    summary: 'Confirm a pending email verification intent (intent cookie + CSRF)',
    request: { body: identityConfirmEmailVerificationRequest, idempotency: true, csrf: true },
    responses: { 200: identityConfirmEmailVerificationResponse },
    errorCodes: [
      'structural_error',
      'authentication',
      'authorization',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'auth.verify-email-confirm',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_LOGIN,
    domain: 'identity',
    authLevel: 'public',
    method: 'POST',
    path: '/api/platform/v1/auth/login',
    summary: 'Authenticate an account and establish a session',
    request: { body: identityLoginRequest, idempotency: true, csrf: false },
    responses: { 200: identityLoginResponse },
    errorCodes: [
      'structural_error',
      'authentication',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'auth.login',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_LOGOUT,
    domain: 'identity',
    authLevel: 'session',
    method: 'POST',
    path: '/api/platform/v1/auth/logout',
    summary: 'Revoke the current session and sign out',
    request: { idempotency: false, csrf: true },
    responses: { 200: identityLogoutResponse },
    errorCodes: ['authentication', 'authorization', 'authority_unavailable'],
    page: 'auth.login',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_REQUEST_PASSWORD_RESET,
    domain: 'identity',
    authLevel: 'public',
    method: 'POST',
    path: '/api/platform/v1/auth/password/request',
    summary: 'Request a password reset email (enumeration-safe)',
    request: { body: identityRequestPasswordResetRequest, idempotency: true, csrf: false },
    responses: { 200: identityRequestPasswordResetResponse },
    errorCodes: [
      'structural_error',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'auth.forgot-password',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_CONFIRM_PASSWORD_RESET,
    domain: 'identity',
    authLevel: 'intent',
    method: 'POST',
    path: '/api/platform/v1/auth/password/confirm',
    summary: 'Confirm a password reset intent and set a new password',
    request: { body: identityConfirmPasswordResetRequest, idempotency: true, csrf: true },
    responses: { 200: identityConfirmPasswordResetResponse },
    errorCodes: [
      'structural_error',
      'authentication',
      'authorization',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'auth.reset-password',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_CHANGE_PASSWORD,
    domain: 'identity',
    authLevel: 'session',
    method: 'POST',
    path: '/api/platform/v1/auth/password/change',
    summary: 'Change the current password and revoke all sessions',
    request: { body: identityChangePasswordRequest, idempotency: true, csrf: true },
    responses: { 200: identityChangePasswordResponse },
    errorCodes: [
      'structural_error',
      'authentication',
      'authorization',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'account.security',
    tags: ['identity', 'auth'],
  },
  {
    operationId: OPERATION_ID_ACCEPT_INVITATION,
    domain: 'organization',
    authLevel: 'session',
    method: 'POST',
    path: '/api/platform/v1/invitations/accept',
    summary: 'Accept an organization invitation atomically (intent cookie + CSRF)',
    request: { body: organizationAcceptInvitationRequest, idempotency: true, csrf: true },
    responses: { 200: organizationAcceptInvitationResponse },
    errorCodes: [
      'structural_error',
      'authentication',
      'authorization',
      'not_found',
      'business_validation',
      'idempotency_conflict',
      'field_validation',
      'rate_limited',
      'authority_unavailable',
    ],
    page: 'invitation.accept',
    tags: ['organization', 'invitation'],
  },
];

export interface BlockedOperation {
  readonly operationId: string;
  readonly domain: string;
  readonly reason: string;
}

export const BLOCKED_OPERATIONS: readonly BlockedOperation[] = [
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
