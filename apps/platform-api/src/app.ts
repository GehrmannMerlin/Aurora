import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { SessionCookieOptions, SessionStore } from '@aurora/platform-session';
import { sessionCookieOptions } from '@aurora/platform-session';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import type { PlatformApiConfig } from './config.js';
import {
  defaultRequestIdProvider,
  requestIdHook,
  type PlatformRequestIdProvider,
} from './request-id.js';
import { applyCookieSessionPlugin } from './plugins/cookie-session.js';
import { applyCsrfPlugin } from './plugins/csrf.js';
import { applyOriginPlugin } from './plugins/origin.js';
import { handleGetSession } from './routes/session.js';
import { handleRegister } from './routes/register.js';
import { handleLogin } from './routes/login.js';
import { handleLogout } from './routes/logout.js';
import {
  handleChangePassword,
  handleConfirmPasswordReset,
  handleRequestPasswordReset,
} from './routes/password.js';
import { handleConfirmEmailVerification } from './routes/email-verification.js';
import { handleAcceptInvitation } from './routes/invitation.js';
import { handleListProjects } from './routes/workspace.js';
import { handleCreateProject } from './routes/projects.js';
import { handleUpdateTimezone } from './routes/settings.js';
import {
  handleListMembers,
  handleChangeRole,
  handleRemoveMember,
  handleTransferOwnership,
} from './routes/members.js';
import {
  handleInviteMember,
  handleRevokeInvitation,
  handleResendInvitation,
} from './routes/invitations.js';
import {
  handleListPrivateTokens,
  handleCreatePrivateToken,
  handleRevokePrivateToken,
} from './routes/private-tokens.js';
import { handleListSecurityAudit } from './routes/audit.js';
import { handleListRequestEndpoints } from './routes/requests.js';
import { handleGetDataStatus } from './routes/diagnostics.js';
import { handleListPerformancePages } from './routes/performance.js';
import { handleGetUsageSummary } from './routes/usage.js';
import {
  handleBatchUpdateIssues,
  handleCreateIssueNote,
  handleDeleteIssueNote,
  handleMergeIssues,
  handleUpdateIssueAssignee,
  handleUpdateIssuePriority,
  handleUpdateIssueState,
} from './routes/issues.js';
import { handleGetIssueDetail, handleListIssues } from './routes/issues-query.js';
import {
  handleCreateAlertRule,
  handleGetAlertInstanceDetail,
  handleGetAlertsCapability,
  handleListRulesAndInstances,
  handleUpdateAlertRule,
} from './routes/alerts.js';
import {
  handleListReleases,
  handleListSourceMapFiles,
  handleReparseRelease,
  handleReplaceSourceMap,
  handleUploadSourceMap,
} from './routes/source-maps.js';
import {
  handleChangeProjectRole,
  handleGrantProjectMembership,
  handleListEffectiveMembers,
  handleRemoveProjectMembership,
} from './routes/access.js';
import {
  handleCreateClientKey,
  handleDisableClientKey,
  handleEnableClientKey,
  handleListClientKeys,
  handleRevokeClientKey,
} from './routes/client-keys.js';
import {
  handleCreateProjectEnvironment,
  handleGetProjectSettings,
  handleListProjectEnvironments,
  handleUpdateProjectSettings,
} from './routes/project-settings.js';
import {
  handleArchiveProject,
  handleMoveProjectToTrash,
  handleRestoreProjectFromArchive,
} from './routes/lifecycle.js';
import { handleListTrash, handleRestoreProject } from './routes/trash.js';
import {
  handleInvitationLink,
  handleResetPasswordLink,
  handleVerifyEmailLink,
} from './routes/intent-links.js';
import {
  handleCancelAccountDeletion,
  handleCancelAccountDeletionIntentLink,
  handleDeleteAccount,
  handleDeleteAccountIntentLink,
  handleDeleteAccountPreflight,
  handleRequestAccountDeletion,
} from './routes/deletion.js';
import {
  handleListNotifications,
  handleMarkNotificationRead,
} from './routes/notifications.js';
import {
  handleGetPlatformAdminCapability,
  handleGrantPlatformAdmin,
  handleListPlatformAdmins,
  handleListPlatformAuditEvents,
  handleRevokePlatformAdmin,
} from './routes/platform-admin.js';
import {
  handlePolicyClearProjectLimit,
  handlePolicyGetDefault,
  handlePolicyGetOrganizationEffective,
  handlePolicyGetProjectEffective,
  handlePolicyResetOrganization,
  handlePolicySetDefault,
  handlePolicySetOrganization,
  handlePolicySetProjectLimit,
  handlePolicyTargetSearch,
} from './routes/resource-policy.js';
import { SESSION_COOKIE_NAME } from './session-cookie.js';
import { InMemoryRateLimiter } from './rate-limit.js';
import { sendProblem } from './error-mapper.js';
import {
  InMemorySourceMapObjectStorage,
  type SourceMapObjectStoragePort,
} from '@aurora/platform-releases';
import type { PlatformApiRouteDependencies } from './route-deps.js';

export interface PlatformApiDependencies {
  readonly config: PlatformApiConfig;
  readonly pool: Pool;
  readonly sessionStore: SessionStore;
  readonly emailPort: EmailDeliveryPort;
  /**
   * DAT-18 private Source Map object storage. Optional: defaults to a fresh
   * disposable in-memory adapter (tests/dev; production S3 wiring pending —
   * PRODUCTION_OBJECT_STORAGE_EVIDENCE_PENDING).
   */
  readonly sourceMapObjectStorage?: SourceMapObjectStoragePort;
  readonly requestIdProvider?: PlatformRequestIdProvider;
  readonly now?: () => Date;
}

/**
 * Build the Fastify platform application. Accepts external dependencies and
 * never creates or closes the caller-provided Pool or Redis session store
 * (mirrors apps/ingestion-api buildIngestionApi).
 *
 * Plugin order is load-bearing: request-id stamps `platformRequestId` first,
 * then cookie-session resolves the session and intent cookie (401/503 for
 * protected ops), then csrf and origin guard state-changing requests. The
 * global error handler maps transport failures (e.g. malformed JSON) to RFC
 * 9457 auroraProblem — never a raw stack or SQL.
 */
export function buildPlatformApi(deps: PlatformApiDependencies): FastifyInstance {
  const requestIdProvider = deps.requestIdProvider ?? defaultRequestIdProvider;
  const now = deps.now ?? (() => new Date());
  const cookieOptions: SessionCookieOptions = sessionCookieOptions(deps.config.cookieSecure);
  const rateLimiter = new InMemoryRateLimiter({
    windowMs: deps.config.rateLimitWindowMs,
    max: deps.config.rateLimitMax,
  });
  const routeContext: PlatformApiRouteDependencies = {
    config: deps.config,
    pool: deps.pool,
    sessionStore: deps.sessionStore,
    emailPort: deps.emailPort,
    sourceMapObjectStorage: deps.sourceMapObjectStorage ?? new InMemorySourceMapObjectStorage(),
    requestIdProvider,
    now,
    cookieOptions,
    rateLimiter,
  };

  const app = Fastify({
    logger: deps.config.logEnabled,
    bodyLimit: 256 * 1024,
  });

  app.decorateRequest('platformRequestId', '');
  app.addHook('onRequest', requestIdHook(requestIdProvider));

  // Plugins are applied directly on the root app so their request decorations
  // and onRequest hooks are visible to every route (Fastify register would
  // encapsulate them away from the root-registered routes).
  applyCookieSessionPlugin(app, {
    store: deps.sessionStore,
    cookieName: SESSION_COOKIE_NAME,
    now,
  });
  applyCsrfPlugin(app);
  applyOriginPlugin(app, { appOrigins: deps.config.appOrigins });

  app.get('/api/platform/v1/health', async (_request, reply) => {
    void reply.code(200).send({ status: 'ok' });
  });

  app.get('/api/platform/v1/session', async (request, reply) => {
    await handleGetSession(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/register', async (request, reply) => {
    await handleRegister(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/login', async (request, reply) => {
    await handleLogin(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/logout', async (request, reply) => {
    await handleLogout(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/password/request', async (request, reply) => {
    await handleRequestPasswordReset(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/password/confirm', async (request, reply) => {
    await handleConfirmPasswordReset(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/password/change', async (request, reply) => {
    await handleChangePassword(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/email/confirm', async (request, reply) => {
    await handleConfirmEmailVerification(request, reply, routeContext);
  });

  app.post('/api/platform/v1/invitations/accept', async (request, reply) => {
    await handleAcceptInvitation(request, reply, routeContext);
  });

  // PLT-04 B1/B2/B4 workspace + project + settings routes. B1 is a session
  // Query; B2/B4 are CSRF-protected (registry) state-changing commands.
  app.get('/api/platform/v1/organizations/:organizationId/projects', async (request, reply) => {
    await handleListProjects(request, reply, routeContext);
  });

  app.post('/api/platform/v1/organizations/:organizationId/projects', async (request, reply) => {
    await handleCreateProject(request, reply, routeContext);
  });

  app.patch(
    '/api/platform/v1/organizations/:organizationId/settings/timezone',
    async (request, reply) => {
      await handleUpdateTimezone(request, reply, routeContext);
    },
  );

  // PLT-04 6C B3/B6/B7/B8 routes. All state-changing commands are CSRF-protected
  // by the plugins (the operation registry marks them csrf:true); GET queries are
  // CSRF-free. Org scoping and fresh membership re-reads live in the handlers.
  app.get('/api/platform/v1/organizations/:organizationId/members', async (request, reply) => {
    await handleListMembers(request, reply, routeContext);
  });

  app.post(
    '/api/platform/v1/organizations/:organizationId/members/:accountId/role',
    async (request, reply) => {
      await handleChangeRole(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/organizations/:organizationId/members/:accountId/remove',
    async (request, reply) => {
      await handleRemoveMember(request, reply, routeContext);
    },
  );

  app.post('/api/platform/v1/organizations/:organizationId/ownership', async (request, reply) => {
    await handleTransferOwnership(request, reply, routeContext);
  });

  app.post('/api/platform/v1/organizations/:organizationId/invitations', async (request, reply) => {
    await handleInviteMember(request, reply, routeContext);
  });

  app.post(
    '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/revoke',
    async (request, reply) => {
      await handleRevokeInvitation(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/resend',
    async (request, reply) => {
      await handleResendInvitation(request, reply, routeContext);
    },
  );

  app.get(
    '/api/platform/v1/organizations/:organizationId/private-tokens',
    async (request, reply) => {
      await handleListPrivateTokens(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/organizations/:organizationId/private-tokens',
    async (request, reply) => {
      await handleCreatePrivateToken(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/organizations/:organizationId/private-tokens/:tokenId/revoke',
    async (request, reply) => {
      await handleRevokePrivateToken(request, reply, routeContext);
    },
  );

  app.get('/api/platform/v1/organizations/:organizationId/audit', async (request, reply) => {
    await handleListSecurityAudit(request, reply, routeContext);
  });

  // DAT-21 B5 usage/quota/degradation projection (org-scoped query). Session +
  // org-manager gating live in the handler; real processed data only.
  app.get('/api/platform/v1/organizations/:organizationId/usage', async (request, reply) => {
    await handleGetUsageSummary(request, reply, routeContext);
  });

  // DAT-16 C5 request monitoring query (first project-scoped route). Session +
  // org membership + project-access gating live in the handler/guards.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/requests',
    async (request, reply) => {
      await handleListRequestEndpoints(request, reply, routeContext);
    },
  );

  // DAT-20 C7 ingestion diagnosis status query (second project-scoped route).
  // Session + org membership + project-access gating live in the handler/guards.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/data-status',
    async (request, reply) => {
      await handleGetDataStatus(request, reply, routeContext);
    },
  );

  // DAT-17 C6 performance metric query projection (third project-scoped route).
  // Session + org membership + project-access gating live in the handler/guards.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/performance',
    async (request, reply) => {
      await handleListPerformancePages(request, reply, routeContext);
    },
  );

  // DAT-15 Issue list/detail Query (2). Project view authorization and safe
  // projection live in the handlers.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues',
    async (request, reply) => {
      await handleListIssues(request, reply, routeContext);
    },
  );
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId',
    async (request, reply) => {
      await handleGetIssueDetail(request, reply, routeContext);
    },
  );

  // DAT-14 Issue lifecycle Commands (7). Project handle authorization, CSRF,
  // idempotency, optimistic version, activity and audit live in the handlers.
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/state',
    async (request, reply) => {
      await handleUpdateIssueState(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/assignee',
    async (request, reply) => {
      await handleUpdateIssueAssignee(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/priority',
    async (request, reply) => {
      await handleUpdateIssuePriority(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/notes',
    async (request, reply) => {
      await handleCreateIssueNote(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/notes/:noteId/delete',
    async (request, reply) => {
      await handleDeleteIssueNote(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId/merge',
    async (request, reply) => {
      await handleMergeIssues(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/batch',
    async (request, reply) => {
      await handleBatchUpdateIssues(request, reply, routeContext);
    },
  );

  // DAT-19 Alert rules/instances (5). Product alerts only (PRD §11); OPS-06
  // operational alerting is a separate concern. Project view auth for reads;
  // project-admin auth for rule create/update (CSRF + idempotency + audit).
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/capability',
    async (request, reply) => {
      await handleGetAlertsCapability(request, reply, routeContext);
    },
  );
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts',
    async (request, reply) => {
      await handleListRulesAndInstances(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules',
    async (request, reply) => {
      await handleCreateAlertRule(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules/:ruleId',
    async (request, reply) => {
      await handleUpdateAlertRule(request, reply, routeContext);
    },
  );
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/instances/:instanceId',
    async (request, reply) => {
      await handleGetAlertInstanceDetail(request, reply, routeContext);
    },
  );

  // DAT-18 Release / Source Map (5). Project view auth for reads; project
  // handle auth (org manager / project_admin / developer, PRD §8.3.10) for
  // upload/replace/reparse. Strict matching by project + release + normalized
  // build path; no cross-version guessing.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases',
    async (request, reply) => {
      await handleListReleases(request, reply, routeContext);
    },
  );
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps',
    async (request, reply) => {
      await handleListSourceMapFiles(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/source-maps',
    async (request, reply) => {
      await handleUploadSourceMap(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps/:sourceMapFileId/replace',
    async (request, reply) => {
      await handleReplaceSourceMap(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/reparse',
    async (request, reply) => {
      await handleReparseRelease(request, reply, routeContext);
    },
  );

  // PLT-08 C13 project access (4). Effective per-person projection for reads;
  // org manager or project_admin for grant/change/remove (CSRF + idempotency +
  // audit). Org-inherited access is read-only on this surface.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/access',
    async (request, reply) => {
      await handleListEffectiveMembers(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members',
    async (request, reply) => {
      await handleGrantProjectMembership(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members/:accountId/role',
    async (request, reply) => {
      await handleChangeProjectRole(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members/:accountId/remove',
    async (request, reply) => {
      await handleRemoveProjectMembership(request, reply, routeContext);
    },
  );

  // PLT-08 C14 client keys (5). Metadata-only list; org manager or project_admin
  // for create (one-time clientKey) / disable / enable / revoke (CSRF +
  // idempotency + audit). The clientKey secret is delivered exactly once.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys',
    async (request, reply) => {
      await handleListClientKeys(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys',
    async (request, reply) => {
      await handleCreateClientKey(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/disable',
    async (request, reply) => {
      await handleDisableClientKey(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/enable',
    async (request, reply) => {
      await handleEnableClientKey(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/revoke',
    async (request, reply) => {
      await handleRevokeClientKey(request, reply, routeContext);
    },
  );

  // PLT-08 C15 project settings + environments (4). Project view auth for
  // reads; org manager or project_admin for update / create-environment.
  // Settings update is versioned (optimistic concurrency).
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings',
    async (request, reply) => {
      await handleGetProjectSettings(request, reply, routeContext);
    },
  );
  app.patch(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings',
    async (request, reply) => {
      await handleUpdateProjectSettings(request, reply, routeContext);
    },
  );
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings/environments',
    async (request, reply) => {
      await handleListProjectEnvironments(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings/environments',
    async (request, reply) => {
      await handleCreateProjectEnvironment(request, reply, routeContext);
    },
  );

  // PLT-08 C16 project lifecycle (3). Archive / restore-from-archive allow org
  // manager or project_admin; move-to-trash is org manager ONLY (name+version
  // confirmed). Each is an independent high-risk command with its own audit.
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/archive',
    async (request, reply) => {
      await handleArchiveProject(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/restore',
    async (request, reply) => {
      await handleRestoreProjectFromArchive(request, reply, routeContext);
    },
  );
  app.post(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/move-to-trash',
    async (request, reply) => {
      await handleMoveProjectToTrash(request, reply, routeContext);
    },
  );

  app.get('/api/platform/v1/organizations/:organizationId/trash', async (request, reply) => {
    await handleListTrash(request, reply, routeContext);
  });

  app.post(
    '/api/platform/v1/organizations/:organizationId/trash/:projectId/restore',
    async (request, reply) => {
      await handleRestoreProject(request, reply, routeContext);
    },
  );

  // Email-link GET routes (ADR-028 决定细节 6): validate the raw token, establish
  // the short-lived intent cookie and clear the token from the URL.
  app.get('/api/platform/v1/auth/verify/:token', async (request, reply) => {
    await handleVerifyEmailLink(request, reply, routeContext);
  });

  app.get('/api/platform/v1/auth/reset/:token', async (request, reply) => {
    await handleResetPasswordLink(request, reply, routeContext);
  });

  app.get('/api/platform/v1/auth/invitations/:token', async (request, reply) => {
    await handleInvitationLink(request, reply, routeContext);
  });

  // SEC-01 A5 account-deletion routes (spec §5.1): preflight (session query),
  // request/cancel intent-link GETs (public, establish the intent cookie) and
  // the request (session + CSRF + idempotent) / cancel (intent + CSRF +
  // idempotent) confirm commands.
  app.get('/api/platform/v1/account/deletion/preflight', async (request, reply) => {
    await handleDeleteAccountPreflight(request, reply, routeContext);
  });

  app.post('/api/platform/v1/account/deletion/request', async (request, reply) => {
    await handleRequestAccountDeletion(request, reply, routeContext);
  });

  app.get('/api/platform/v1/account/deletion/intent/:token', async (request, reply) => {
    await handleDeleteAccountIntentLink(request, reply, routeContext);
  });

  app.post('/api/platform/v1/account/deletion', async (request, reply) => {
    await handleDeleteAccount(request, reply, routeContext);
  });

  app.get('/api/platform/v1/account/deletion/cancel/intent/:token', async (request, reply) => {
    await handleCancelAccountDeletionIntentLink(request, reply, routeContext);
  });

  app.post('/api/platform/v1/account/deletion/cancel', async (request, reply) => {
    await handleCancelAccountDeletion(request, reply, routeContext);
  });

  // PLT-09 D1 account-level notification routes: list + unread (session query)
  // and mark-read (session + CSRF + idempotent command). Account-scoped; the
  // repository isolates rows by the session account.
  app.get('/api/platform/v1/notifications', async (request, reply) => {
    await handleListNotifications(request, reply, routeContext);
  });

  app.post('/api/platform/v1/notifications/:notificationId/read', async (request, reply) => {
    await handleMarkNotificationRead(request, reply, routeContext);
  });

  // PLT-10a D2 platform admin/audit routes (ADR-034). Capability is session-only
  // (any authenticated session may probe its own platform admin capability).
  // admins-list, grant, revoke and audit-list are gated by `requirePlatformAdmin`
  // (fresh `platform_admins` re-read; non-admin → closed 403). Grant/revoke are
  // CSRF + idempotent commands that write their audit INSIDE the idempotency
  // transaction; the admin/audit reads write an `audit_read` audit event.
  app.get('/api/platform/v1/platform-admin/capability', async (request, reply) => {
    await handleGetPlatformAdminCapability(request, reply, routeContext);
  });

  app.get('/api/platform/v1/platform-admin/admins', async (request, reply) => {
    await handleListPlatformAdmins(request, reply, routeContext);
  });

  app.post('/api/platform/v1/platform-admin/admins/:accountId/grant', async (request, reply) => {
    await handleGrantPlatformAdmin(request, reply, routeContext);
  });

  app.post('/api/platform/v1/platform-admin/admins/:accountId/revoke', async (request, reply) => {
    await handleRevokePlatformAdmin(request, reply, routeContext);
  });

  app.get('/api/platform/v1/platform-admin/audit', async (request, reply) => {
    await handleListPlatformAuditEvents(request, reply, routeContext);
  });

  // PLT-10b D2 platform resource-policy routes (ADR-035). All nine operations
  // are gated by `requirePlatformAdmin` (fresh `platform_admins` re-read; a
  // non-admin gets a closed 403 with no policy/directory data leaked). The three
  // effective-policy GET queries write an `audit_read` platform audit event; the
  // five POST commands are CSRF + idempotent and write their `policy_*` audit
  // INSIDE the idempotency transaction.
  app.get('/api/platform/v1/platform-admin/policy/targets', async (request, reply) => {
    await handlePolicyTargetSearch(request, reply, routeContext);
  });

  app.get('/api/platform/v1/platform-admin/policy/default', async (request, reply) => {
    await handlePolicyGetDefault(request, reply, routeContext);
  });

  app.post('/api/platform/v1/platform-admin/policy/default', async (request, reply) => {
    await handlePolicySetDefault(request, reply, routeContext);
  });

  app.get(
    '/api/platform/v1/platform-admin/policy/organizations/:organizationId/effective',
    async (request, reply) => {
      await handlePolicyGetOrganizationEffective(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/platform-admin/policy/organizations/:organizationId',
    async (request, reply) => {
      await handlePolicySetOrganization(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/platform-admin/policy/organizations/:organizationId/reset',
    async (request, reply) => {
      await handlePolicyResetOrganization(request, reply, routeContext);
    },
  );

  app.get(
    '/api/platform/v1/platform-admin/policy/projects/:projectId/effective',
    async (request, reply) => {
      await handlePolicyGetProjectEffective(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/platform-admin/policy/projects/:projectId/limit',
    async (request, reply) => {
      await handlePolicySetProjectLimit(request, reply, routeContext);
    },
  );

  app.post(
    '/api/platform/v1/platform-admin/policy/projects/:projectId/limit/clear',
    async (request, reply) => {
      await handlePolicyClearProjectLimit(request, reply, routeContext);
    },
  );

  app.setNotFoundHandler(async (request, reply) => {
    const requestId = request.platformRequestId || defaultRequestIdProvider();
    void reply.header('x-aurora-request-id', requestId).code(404).send({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      detail: 'The requested resource was not found.',
      code: 'not_found',
      requestId,
    });
  });

  // Global error handler: any unhandled transport/parse error maps to RFC 9457
  // auroraProblem. Malformed JSON is a structural error; everything else is a
  // closed internal_error. No stack, SQL, token, password or session id is ever
  // surfaced or logged (ADR-030 实施约束).
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.platformRequestId || defaultRequestIdProvider();
    if (isStructuralParseError(error)) {
      return sendProblem(
        reply,
        requestId,
        400,
        'structural_error',
        'Request body is not valid JSON.',
      );
    }
    return sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
  });

  return app;
}

/**
 * Fastify's built-in JSON body parser throws a `FastifyError` with
 * `code = 'FST_ERR_CTP_INVALID_JSON_BODY'` and `statusCode = 400` (not a plain
 * `SyntaxError`). Map those (and any other 400 transport error) to a structural
 * error rather than a 500.
 */
function isStructuralParseError(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return (
    candidate.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    candidate.status === 400 ||
    candidate.statusCode === 400
  );
}
