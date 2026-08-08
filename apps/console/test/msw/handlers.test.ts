import { setupServer } from 'msw/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SCOPE_KEY = '__aurora_mock_scope';
const CONTEXT_URL = new URL('/api/platform/v1/navigation/context', window.location.origin).href;
const SCOPE_URL = new URL('/__mock/scope', window.location.origin).href;

interface ScopeProjection {
  type: string;
  id?: string;
  lifecycle: string;
}

/**
 * Re-import only the handlers module after seeding sessionStorage so the module-level
 * `readStoredScope()` runs against the seeded value (the module caches it at load).
 * `setupServer` stays on the statically-imported msw instance so its interceptor
 * remains the one actively wired to the global fetch.
 */
async function freshServer() {
  vi.resetModules();
  const { createPlatformHandlers } = await import('../../src/mocks/handlers.js');
  const server = setupServer(...createPlatformHandlers());
  server.listen({ onUnhandledRequest: 'error' });
  return server;
}

async function currentScopeWithStored(raw: string | null): Promise<ScopeProjection> {
  if (raw === null) sessionStorage.removeItem(SCOPE_KEY);
  else sessionStorage.setItem(SCOPE_KEY, raw);
  const server = await freshServer();
  try {
    const res = await fetch(CONTEXT_URL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { currentScope: ScopeProjection };
    return body.currentScope;
  } finally {
    server.close();
    sessionStorage.removeItem(SCOPE_KEY);
  }
}

afterEach(() => {
  sessionStorage.removeItem(SCOPE_KEY);
});

describe('mock platform handlers', () => {
  it('defaults to the project scope when nothing is stored', async () => {
    expect(await currentScopeWithStored(null)).toEqual({
      type: 'project',
      id: 'prj_test_1',
      lifecycle: 'active',
    });
  });

  it('restores a stored workspace scope on module load', async () => {
    expect(await currentScopeWithStored(JSON.stringify({ type: 'workspace' }))).toEqual({
      type: 'workspace',
      lifecycle: 'active',
    });
  });

  it('restores a stored organization scope with its id on module load', async () => {
    expect(
      await currentScopeWithStored(JSON.stringify({ type: 'organization', id: 'org_test_1' })),
    ).toEqual({ type: 'organization', id: 'org_test_1', lifecycle: 'active' });
  });

  it('ignores an invalid or non-object stored scope and falls back to the default', async () => {
    expect(await currentScopeWithStored(JSON.stringify({ type: 'bogus' }))).toEqual({
      type: 'project',
      id: 'prj_test_1',
      lifecycle: 'active',
    });
    expect(await currentScopeWithStored(JSON.stringify('not-an-object'))).toEqual({
      type: 'project',
      id: 'prj_test_1',
      lifecycle: 'active',
    });
  });

  it('persists a posted project scope and reflects it in the navigation context', async () => {
    sessionStorage.removeItem(SCOPE_KEY);
    const server = await freshServer();
    try {
      const post = await fetch(SCOPE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'project', id: 'prj_b' }),
      });
      expect(post.status).toBe(204);
      expect(JSON.parse(sessionStorage.getItem(SCOPE_KEY) ?? 'null')).toEqual({
        type: 'project',
        id: 'prj_b',
      });
      const res = await fetch(CONTEXT_URL);
      const body = (await res.json()) as { currentScope: ScopeProjection };
      expect(body.currentScope).toEqual({ type: 'project', id: 'prj_b', lifecycle: 'active' });
    } finally {
      server.close();
      sessionStorage.removeItem(SCOPE_KEY);
    }
  });

  it('persists a posted workspace scope without an id', async () => {
    sessionStorage.removeItem(SCOPE_KEY);
    const server = await freshServer();
    try {
      const post = await fetch(SCOPE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'workspace' }),
      });
      expect(post.status).toBe(204);
      expect(JSON.parse(sessionStorage.getItem(SCOPE_KEY) ?? 'null')).toEqual({
        type: 'workspace',
      });
      const res = await fetch(CONTEXT_URL);
      const body = (await res.json()) as { currentScope: ScopeProjection };
      expect(body.currentScope).toEqual({ type: 'workspace', lifecycle: 'active' });
    } finally {
      server.close();
      sessionStorage.removeItem(SCOPE_KEY);
    }
  });

  it('falls back to the default when storage access fails', async () => {
    vi.stubGlobal('sessionStorage', undefined);
    try {
      const server = await freshServer();
      try {
        const res = await fetch(CONTEXT_URL);
        const body = (await res.json()) as { currentScope: ScopeProjection };
        expect(body.currentScope).toEqual({
          type: 'project',
          id: 'prj_test_1',
          lifecycle: 'active',
        });
      } finally {
        server.close();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still applies a posted scope when storage cannot persist it', async () => {
    vi.stubGlobal('sessionStorage', undefined);
    try {
      const server = await freshServer();
      try {
        const post = await fetch(SCOPE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'workspace' }),
        });
        expect(post.status).toBe(204);
        const res = await fetch(CONTEXT_URL);
        const body = (await res.json()) as { currentScope: ScopeProjection };
        expect(body.currentScope).toEqual({ type: 'workspace', lifecycle: 'active' });
      } finally {
        server.close();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
