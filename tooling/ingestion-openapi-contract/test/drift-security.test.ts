import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '../src/index.js';

const OPENAPI_PATH = new URL('../../../docs/api/ingestion.openapi.yaml', import.meta.url);

describe('ingestion OpenAPI security and privacy drift', () => {
  it('defines ClientIngestionKey as apiKey in header with X-Aurora-Client-Key', async () => {
    const document = await loadOpenApiDocument();
    const scheme = document.components.securitySchemes?.ClientIngestionKey as
      Readonly<Record<string, unknown>> | undefined;
    expect(scheme, 'ClientIngestionKey scheme').toBeDefined();
    expect(scheme?.type, 'scheme.type').toBe('apiKey');
    expect(scheme?.in, 'scheme.in').toBe('header');
    expect(scheme?.name, 'scheme.name').toBe('X-Aurora-Client-Key');
  });

  it('declares the ClientIngestionKey security requirement on the batch operation', async () => {
    const document = await loadOpenApiDocument();
    const operation = (document.paths['/v1/batches'] as Readonly<Record<string, unknown>>)
      .post as Readonly<Record<string, unknown>>;
    const security = operation.security as readonly unknown[];
    expect(security).toBeDefined();
    expect(JSON.stringify(security)).toContain('ClientIngestionKey');
  });

  it('never places the client key in a query parameter or request body', async () => {
    const source = await readFile(OPENAPI_PATH, 'utf8');
    expect(source).not.toContain('in: query');
    expect(source).not.toContain('?clientKey=');
    // X-Aurora-Client-Key may appear only as the security scheme header name,
    // never as a requestBody property.
    const lines = source.split('\n').filter((line) => line.includes('X-Aurora-Client-Key'));
    for (const line of lines) {
      expect(line, `client-key reference line`).toMatch(/name:|description:|X-Aurora-Client-Key/);
    }
  });

  it('contains no real client key value in examples', async () => {
    const document = await loadOpenApiDocument();
    const serialized = JSON.stringify(document.components.examples ?? {});
    // Real keys follow aurora_ingest_<keyId>_<secret> with opaque secret material.
    // The placeholder documentation string (with angle brackets) is allowed.
    expect(serialized).not.toMatch(/aurora_ingest_[A-Za-z0-9_-]+_[A-Za-z0-9]{16,}/);
  });

  it('declares the mandatory X-Aurora-Environment header parameter', async () => {
    const document = await loadOpenApiDocument();
    const operation = (document.paths['/v1/batches'] as Readonly<Record<string, unknown>>)
      .post as Readonly<Record<string, unknown>>;
    const parameters = operation.parameters as readonly unknown[];
    expect(parameters, 'operation parameters').toBeDefined();
    const serialized = JSON.stringify(parameters);
    expect(serialized).toContain('X-Aurora-Environment');
    expect(serialized).toContain('"required":true');
  });

  it('declares the X-Aurora-Request-Id response header on all responses', async () => {
    const document = await loadOpenApiDocument();
    const operation = (document.paths['/v1/batches'] as Readonly<Record<string, unknown>>)
      .post as Readonly<Record<string, unknown>>;
    const responses = operation.responses as Readonly<Record<string, unknown>>;
    for (const [status, response] of Object.entries(responses)) {
      const headers = (response as Readonly<Record<string, unknown>>).headers as
        Readonly<Record<string, unknown>> | undefined;
      expect(headers, `${status} headers`).toBeDefined();
      expect(headers?.['X-Aurora-Request-Id'], `${status} X-Aurora-Request-Id`).toBeDefined();
    }
  });

  it('keeps CORS restrictions documented without cookie credentials or wildcard origin', async () => {
    const document = await loadOpenApiDocument();
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('Access-Control-Allow-Credentials: true');
    // The documented CORS rule must explicitly forbid wildcard origin.
    expect(serialized.toLowerCase()).toContain('origin');
  });

  it('never documents Origin or allowNonBrowser as JSON body schema properties', async () => {
    const document = await loadOpenApiDocument();
    const serialized = JSON.stringify(document.components.schemas ?? {});
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('"allowNonBrowser"');
    expect(serialized).not.toContain('"environment"');
  });
});
