import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  orgNavigation,
  requireOrgManager,
  requireOrgOwner,
  requireSession,
  requireUuidParams,
} from '../src/routes/_shared.js';
import type { EffectivePermissions } from '../src/authorization.js';

/** Build a minimal reply double that records the problem sent via sendProblem. */
function mockReply(): { reply: FastifyReply; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  const reply = {
    header: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
    send,
  };
  return { reply: reply as unknown as FastifyReply, send };
}

function mockRequest(overrides: {
  sessionUnavailable?: boolean;
  sessionPayload?: unknown;
}): FastifyRequest {
  return {
    sessionUnavailable: overrides.sessionUnavailable ?? false,
    sessionPayload: overrides.sessionPayload ?? null,
  } as unknown as FastifyRequest;
}

const SESSION_PAYLOAD = {
  accountId: 'account-1',
  authLevel: 'authenticated',
  expiresAt: '2026-08-09T08:00:00.000Z',
  rotationDueAt: null,
  csrfSecret: 'csrf',
} as const;

describe('requireSession', () => {
  it('returns the session payload when a valid session exists', async () => {
    const { reply, send } = mockReply();
    const request = mockRequest({ sessionUnavailable: false, sessionPayload: SESSION_PAYLOAD });

    const result = await requireSession(request, reply, 'req-1');

    expect(result).toBe(SESSION_PAYLOAD);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed with 503 authority_unavailable when the session authority is down', async () => {
    const { reply, send } = mockReply();
    const request = mockRequest({ sessionUnavailable: true, sessionPayload: null });

    const result = await requireSession(request, reply, 'req-1');

    expect(result).toBeNull();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503, code: 'authority_unavailable' }),
    );
  });

  it('returns 401 authentication with a login recovery target when no session', async () => {
    const { reply, send } = mockReply();
    const request = mockRequest({ sessionUnavailable: false, sessionPayload: null });

    const result = await requireSession(request, reply, 'req-1');

    expect(result).toBeNull();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        code: 'authentication',
        recoveryTarget: 'auth.login',
      }),
    );
  });
});

describe('requireOrgManager / requireOrgOwner', () => {
  const manager: EffectivePermissions = {
    orgRole: 'admin',
    isOrgManager: true,
    isOwner: false,
    allowedActions: [],
  };
  const owner: EffectivePermissions = {
    orgRole: 'owner',
    isOrgManager: true,
    isOwner: true,
    allowedActions: [],
  };
  const member: EffectivePermissions = {
    orgRole: 'member',
    isOrgManager: false,
    isOwner: false,
    allowedActions: [],
  };

  it('requireOrgManager allows a manager', async () => {
    const { reply, send } = mockReply();
    expect(await requireOrgManager(manager, reply, 'req-1')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('requireOrgManager rejects a non-manager with 403 authorization', async () => {
    const { reply, send } = mockReply();
    expect(await requireOrgManager(member, reply, 'req-1')).toBe(false);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, code: 'authorization' }),
    );
  });

  it('requireOrgOwner allows an owner', async () => {
    const { reply, send } = mockReply();
    expect(await requireOrgOwner(owner, reply, 'req-1')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('requireOrgOwner rejects a non-owner manager with 403 authorization', async () => {
    const { reply, send } = mockReply();
    expect(await requireOrgOwner(manager, reply, 'req-1')).toBe(false);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403, code: 'authorization' }),
    );
  });
});

describe('requireUuidParams', () => {
  it('accepts canonical uuid params', () => {
    const { reply, send } = mockReply();
    const ok = requireUuidParams(
      { organizationId: '123e4567-e89b-12d3-a456-426614174000' },
      reply,
      'req-1',
    );
    expect(ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts an empty param map', () => {
    const { reply, send } = mockReply();
    expect(requireUuidParams({}, reply, 'req-1')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid string param with 400 structural_error', () => {
    const { reply, send } = mockReply();
    const ok = requireUuidParams({ organizationId: 'not-a-uuid' }, reply, 'req-1');
    expect(ok).toBe(false);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: 400, code: 'structural_error' }),
    );
  });

  it('rejects when any path param is not a canonical uuid', () => {
    const { reply, send } = mockReply();
    const ok = requireUuidParams(
      {
        organizationId: '123e4567-e89b-12d3-a456-426614174000',
        projectId: 'not-a-uuid',
      },
      reply,
      'req-1',
    );
    expect(ok).toBe(false);
    expect(send).toHaveBeenCalled();
  });
});

describe('orgNavigation', () => {
  it('builds a single org-scoped navigation target', () => {
    expect(orgNavigation('organization.members', 'org-123')).toEqual([
      { routeId: 'organization.members', pathParams: { organizationId: 'org-123' }, query: {} },
    ]);
  });

  it('uses an empty query and the current organization as the only path param', () => {
    expect(orgNavigation('organization.tokens', 'org-456')).toEqual([
      { routeId: 'organization.tokens', pathParams: { organizationId: 'org-456' }, query: {} },
    ]);
  });
});
