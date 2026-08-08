import { ApiError, normalizeProblem } from './errors.js';

/**
 * Email-link intent GET endpoints (ADR-028 决定细节 6 / spec §7.2). These are NOT
 * registered Platform operations — they validate the raw one-time token, establish
 * the short-lived HttpOnly intent cookie, and return the intent-bound CSRF secret
 * so the raw token can be cleared from the address bar. The client treats them as
 * out-of-band reads and never persists the token.
 */
export type IntentLinkKind = 'email_verification' | 'password_reset' | 'organization_invitation';

export interface IntentLinkResult {
  readonly status: 'valid';
  readonly csrf: string;
  readonly maskedEmail?: string;
  readonly organizationName?: string;
  readonly role?: 'owner' | 'admin' | 'member';
}

const PATH_BY_KIND: Readonly<Record<IntentLinkKind, string>> = {
  email_verification: '/api/platform/v1/auth/verify/',
  password_reset: '/api/platform/v1/auth/reset/',
  organization_invitation: '/api/platform/v1/auth/invitations/',
};

interface IntentLinkBody {
  readonly status: unknown;
  readonly csrf: unknown;
  readonly maskedEmail?: unknown;
  readonly organizationName?: unknown;
  readonly role?: unknown;
}

export async function fetchIntentLink(
  kind: IntentLinkKind,
  token: string,
): Promise<IntentLinkResult> {
  const url = new URL(
    `${PATH_BY_KIND[kind]}${encodeURIComponent(token)}`,
    window.location.origin,
  );
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError({ code: 'network_error', message: 'Network request failed.' });
  }
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) throw normalizeProblem(raw, response.status);
  if (raw === null || typeof raw !== 'object') {
    throw new ApiError({
      code: 'structural_error',
      status: response.status,
      message: 'Response does not match the public contract.',
    });
  }
  const body = raw as IntentLinkBody;
  if (body.status !== 'valid' || typeof body.csrf !== 'string') {
    throw new ApiError({
      code: 'structural_error',
      status: response.status,
      message: 'Response does not match the public contract.',
    });
  }
  const result: IntentLinkResult = {
    status: 'valid',
    csrf: body.csrf,
    ...(typeof body.maskedEmail === 'string' ? { maskedEmail: body.maskedEmail } : {}),
    ...(typeof body.organizationName === 'string' ? { organizationName: body.organizationName } : {}),
    ...(body.role === 'owner' || body.role === 'admin' || body.role === 'member'
      ? { role: body.role }
      : {}),
  };
  return result;
}
