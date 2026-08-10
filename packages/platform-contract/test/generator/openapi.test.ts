import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../../src/generator/openapi.js';
import { PLATFORM_OPERATIONS } from '../../src/registry/operations.js';

describe('openapi generator', () => {
  it('produces a deterministic v1 document', () => {
    const a = JSON.stringify(generateOpenApiDocument());
    const b = JSON.stringify(generateOpenApiDocument());
    expect(a).toBe(b);
  });

  it('emits exactly the stable operations as paths', () => {
    const doc = generateOpenApiDocument();
    // Multiple operations may share a path (list + create on the same resource), so count the
    // emitted operations across all paths rather than the number of unique paths.
    const emittedOps = Object.values(doc.paths).reduce<number>(
      (count, path) => count + Object.keys(path as Record<string, unknown>).length,
      0,
    );
    expect(emittedOps).toBe(PLATFORM_OPERATIONS.length);
    expect(doc.paths['/session']).toBeDefined();
    expect(doc.paths['/navigation/context']).toBeDefined();
    expect(doc.paths['/auth/register']).toBeDefined();
    expect(doc.paths['/auth/login']).toBeDefined();
    expect(doc.paths['/invitations/accept']).toBeDefined();
    expect(doc.paths['/organizations/{organizationId}/projects']).toBeDefined();
    expect(doc.paths['/organizations/{organizationId}/members']).toBeDefined();
    expect(doc.paths['/organizations/{organizationId}/private-tokens']).toBeDefined();
    expect(doc.paths['/organizations/{organizationId}/audit']).toBeDefined();
    expect(doc.paths['/organizations/{organizationId}/trash']).toBeDefined();
  });

  it('emits valid OpenAPI 3.1 path templating and declares path parameters', () => {
    const doc = generateOpenApiDocument();
    // The internal colon-style `:param` paths are the canonical Fastify form; the machine OpenAPI
    // must convert them to OpenAPI 3.1 `{param}` templating (no colon-style keys may remain).
    expect(doc.paths['/organizations/:organizationId/projects']).toBeUndefined();

    const projectsPath = doc.paths['/organizations/{organizationId}/projects'] as Record<
      string,
      unknown
    >;
    expect(projectsPath).toBeDefined();
    const listProjects = projectsPath.get as Record<string, unknown>;
    const listProjectsParameters = listProjects.parameters as Record<string, unknown>[];
    const listProjectsPathParam = listProjectsParameters.find((p) => p.in === 'path');
    expect(listProjectsPathParam).toMatchObject({
      name: 'organizationId',
      in: 'path',
      required: true,
    });
    expect(listProjectsPathParam?.schema).toMatchObject({ type: 'string' });

    // Multi-segment path: every templated segment must have a declared path parameter.
    const changeRolePath = doc.paths[
      '/organizations/{organizationId}/members/{accountId}/role'
    ] as Record<string, unknown>;
    expect(changeRolePath).toBeDefined();
    const changeRole = changeRolePath.post as Record<string, unknown>;
    const changeRolePathParams = (changeRole.parameters as Record<string, unknown>[]).filter(
      (p) => p.in === 'path',
    );
    expect(changeRolePathParams.map((p) => p.name)).toEqual(['organizationId', 'accountId']);
    for (const param of changeRolePathParams) {
      expect(param).toMatchObject({ in: 'path', required: true });
    }
  });

  it('does not emit blocked operations as empty schemas', () => {
    const doc = generateOpenApiDocument();
    const json = JSON.stringify(doc);
    expect(json).not.toContain('usageGetSummary');
    expect(json).not.toContain('onboardingGetProgress');
    // The newly unblocked request metric projection is emitted as a stable path.
    expect(
      doc.paths['/organizations/{organizationId}/projects/{projectId}/requests'],
    ).toBeDefined();
    // The newly unblocked ingestion diagnosis projection is emitted as a stable path.
    expect(
      doc.paths['/organizations/{organizationId}/projects/{projectId}/data-status'],
    ).toBeDefined();
    // The newly unblocked performance metric projection is emitted as a stable path.
    expect(
      doc.paths['/organizations/{organizationId}/projects/{projectId}/performance'],
    ).toBeDefined();
  });

  it('names response schemas stably', () => {
    const doc = generateOpenApiDocument();
    expect(
      (doc.components.schemas as Record<string, unknown>).identityGetSessionResponse,
    ).toBeDefined();
  });
});
