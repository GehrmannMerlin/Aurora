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
import { SESSION_COOKIE_NAME } from './session-cookie.js';
import { InMemoryRateLimiter } from './rate-limit.js';
import { sendProblem } from './error-mapper.js';
import type { PlatformApiRouteDependencies } from './route-deps.js';

export interface PlatformApiDependencies {
  readonly config: PlatformApiConfig;
  readonly pool: Pool;
  readonly sessionStore: SessionStore;
  readonly emailPort: EmailDeliveryPort;
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

  // DAT-16 C5 request monitoring query (first project-scoped route). Session +
  // org membership + project-access gating live in the handler/guards.
  app.get(
    '/api/platform/v1/organizations/:organizationId/projects/:projectId/requests',
    async (request, reply) => {
      await handleListRequestEndpoints(request, reply, routeContext);
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
