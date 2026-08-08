import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  findEmailVerificationIntentByDigest,
  findInvitationByDigest,
  findOrganizationById,
  findPasswordResetIntentByDigest,
  getAccountById,
} from '@aurora/platform-identity';
import { createCsrfSecret } from '@aurora/platform-session';
import { sendProblem } from '../error-mapper.js';
import { setIntentCookie } from '../intent-cookie.js';
import { maskEmail } from '../email-mask.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

interface TokenParams {
  readonly token: string;
}

/** SHA-256 hex digest of a transient intent token (matches platform-identity). */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Shared GET intent-link flow (ADR-028 决定细节 6 / spec §7.2): the email link
 * carries the raw one-time token; this GET validates it against the intent
 * table (which stores only the SHA-256 digest), establishes a short-lived
 * HttpOnly `aurora_intent` cookie (kind + transient token + intent-bound CSRF
 * secret) so the raw token is cleared from the URL, and returns the intent CSRF
 * token for the CSRF-protected confirm POST. Expired/consumed intents map to
 * 409 (no account-existence leak — the token is a capability).
 */

/** GET /api/platform/v1/auth/verify/:token — email verification link. */
export async function handleVerifyEmailLink(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const params = request.params as TokenParams;
  const token = params.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findEmailVerificationIntentByDigest(deps.pool, digestOf(token));
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Account store is temporarily unavailable.');
    return;
  }
  const now = deps.now().getTime();
  if (
    intent === null ||
    intent.consumedAt !== null ||
    Date.parse(intent.expiresAt) <= now
  ) {
    await sendProblem(reply, requestId, 409, 'business_validation', 'The verification intent is no longer valid.');
    return;
  }

  let masked = '';
  try {
    const account = await getAccountById(deps.pool, intent.accountId);
    if (account !== null) masked = maskEmail(account.email);
  } catch {
    // The intent is valid; a display mask is best-effort and never a blocker.
  }

  const csrfSecret = createCsrfSecret();
  const remainingMs = Math.max(60_000, Date.parse(intent.expiresAt) - now);
  setIntentCookie(reply, 'email_verification', token, csrfSecret, deps.cookieOptions, remainingMs);

  void reply.header('x-aurora-request-id', requestId).code(200).send({
    status: 'valid',
    csrf: csrfSecret,
    maskedEmail: masked,
  });
}

/** GET /api/platform/v1/auth/reset/:token — password reset link. */
export async function handleResetPasswordLink(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const params = request.params as TokenParams;
  const token = params.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findPasswordResetIntentByDigest(deps.pool, digestOf(token));
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Account store is temporarily unavailable.');
    return;
  }
  const now = deps.now().getTime();
  if (
    intent === null ||
    intent.consumedAt !== null ||
    Date.parse(intent.expiresAt) <= now
  ) {
    await sendProblem(reply, requestId, 409, 'business_validation', 'The reset intent is no longer valid.');
    return;
  }

  const csrfSecret = createCsrfSecret();
  const remainingMs = Math.max(60_000, Date.parse(intent.expiresAt) - now);
  setIntentCookie(reply, 'password_reset', token, csrfSecret, deps.cookieOptions, remainingMs);

  void reply.header('x-aurora-request-id', requestId).code(200).send({
    status: 'valid',
    csrf: csrfSecret,
  });
}

/** GET /api/platform/v1/auth/invitations/:token — invitation link. */
export async function handleInvitationLink(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const params = request.params as TokenParams;
  const token = params.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The intent was not found.');
    return;
  }

  let invitation;
  try {
    invitation = await findInvitationByDigest(deps.pool, digestOf(token));
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Account store is temporarily unavailable.');
    return;
  }
  const now = deps.now().getTime();
  if (
    invitation === null ||
    invitation.status !== 'pending' ||
    Date.parse(invitation.expiresAt) <= now
  ) {
    await sendProblem(reply, requestId, 409, 'business_validation', 'The invitation is no longer valid.');
    return;
  }

  const csrfSecret = createCsrfSecret();
  const remainingMs = Math.max(60_000, Date.parse(invitation.expiresAt) - now);
  setIntentCookie(reply, 'organization_invitation', token, csrfSecret, deps.cookieOptions, remainingMs);

  // N7/N2 reconciliation: the accept page needs the masked invited email (never the
  // raw address) and a read-only permission summary (org name + granted role) to render
  // the invitation before the user decides to accept. Org name is best-effort; the
  // invitation row itself is authoritative for the role and masked email.
  let organizationName = '';
  try {
    const organization = await findOrganizationById(deps.pool, invitation.organizationId);
    if (organization !== null) organizationName = organization.name;
  } catch {
    // The intent is valid; the org display name is best-effort and never a blocker.
  }

  void reply.header('x-aurora-request-id', requestId).code(200).send({
    status: 'valid',
    csrf: csrfSecret,
    maskedEmail: maskEmail(invitation.invitedEmail),
    organizationName,
    role: invitation.orgRole,
  });
}
