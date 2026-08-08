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
    const pathCount = Object.keys(doc.paths).length;
    expect(pathCount).toBe(PLATFORM_OPERATIONS.length);
    expect(doc.paths['/session']).toBeDefined();
    expect(doc.paths['/navigation/context']).toBeDefined();
    expect(doc.paths['/auth/register']).toBeDefined();
    expect(doc.paths['/auth/login']).toBeDefined();
    expect(doc.paths['/invitations/accept']).toBeDefined();
  });

  it('does not emit blocked operations as empty schemas', () => {
    const doc = generateOpenApiDocument();
    const json = JSON.stringify(doc);
    expect(json).not.toContain('organizationCreateProject');
    expect(json).not.toContain('projectCreateProject');
    expect(json).not.toContain('"type":"object","properties":{}');
  });

  it('names response schemas stably', () => {
    const doc = generateOpenApiDocument();
    expect(
      (doc.components.schemas as Record<string, unknown>).identityGetSessionResponse,
    ).toBeDefined();
  });
});
