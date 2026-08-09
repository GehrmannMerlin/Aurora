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
    expect(doc.paths['/organizations/:organizationId/projects']).toBeDefined();
    expect(doc.paths['/organizations/:organizationId/members']).toBeDefined();
    expect(doc.paths['/organizations/:organizationId/private-tokens']).toBeDefined();
    expect(doc.paths['/organizations/:organizationId/audit']).toBeDefined();
    expect(doc.paths['/organizations/:organizationId/trash']).toBeDefined();
  });

  it('does not emit blocked operations as empty schemas', () => {
    const doc = generateOpenApiDocument();
    const json = JSON.stringify(doc);
    expect(json).not.toContain('usageGetSummary');
    expect(json).not.toContain('onboardingGetProgress');
    expect(json).not.toContain('"type":"object","properties":{}');
  });

  it('names response schemas stably', () => {
    const doc = generateOpenApiDocument();
    expect(
      (doc.components.schemas as Record<string, unknown>).identityGetSessionResponse,
    ).toBeDefined();
  });
});
