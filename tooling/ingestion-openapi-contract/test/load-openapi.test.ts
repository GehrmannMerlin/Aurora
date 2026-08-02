import { describe, expect, it } from 'vitest';
import { componentSchema, loadOpenApiDocument } from '../src/index.js';

describe('load-openapi', () => {
  it('parses the machine file as an OpenAPI 3.1 document', async () => {
    const document = await loadOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/v1/batches']).toBeDefined();
  });

  it('throws when a component schema is missing', async () => {
    const document = await loadOpenApiDocument();
    expect(() => componentSchema(document, 'DefinitelyMissingSchema')).toThrow(
      /Missing components\.schemas/,
    );
  });
});
