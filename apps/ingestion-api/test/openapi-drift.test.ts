import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

interface OpenApiDoc {
  readonly openapi: string;
  readonly components: {
    readonly securitySchemes?: Record<string, unknown>;
  };
  readonly paths: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

describe('ingestion-api OpenAPI drift', () => {
  async function loadOpenApi(): Promise<OpenApiDoc> {
    const source = await readFile(
      new URL('../../../docs/api/ingestion.openapi.yaml', import.meta.url),
      'utf8',
    );
    return parseYaml(source) as OpenApiDoc;
  }

  function batchPath(doc: OpenApiDoc): Record<string, unknown> | undefined {
    return asRecord(doc.paths['/v1/batches']);
  }

  function batchPost(doc: OpenApiDoc): Record<string, unknown> | undefined {
    const path = batchPath(doc);
    return path === undefined ? undefined : asRecord(path.post);
  }

  it('declares POST /v1/batches with operationId ingestionSubmitBatch', async () => {
    const doc = await loadOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    const post = batchPost(doc);
    expect(post).toBeDefined();
    expect(post?.operationId).toBe('ingestionSubmitBatch');
  });

  it('declares the apiKey security scheme for X-Aurora-Client-Key', async () => {
    const doc = await loadOpenApi();
    const scheme = asRecord(doc.components.securitySchemes?.ClientIngestionKey);
    expect(scheme?.type).toBe('apiKey');
    expect(scheme?.in).toBe('header');
    expect(scheme?.name).toBe('X-Aurora-Client-Key');
  });

  it('declares all required response status codes', async () => {
    const doc = await loadOpenApi();
    const post = batchPost(doc);
    const responses = post === undefined ? undefined : asRecord(post.responses);
    for (const status of ['200', '400', '401', '403', '413', '415', '429', '500', '503']) {
      expect(asRecord(responses?.[status]), `response ${status}`).toBeDefined();
    }
  });

  it('uses IngestionRequestReceipt for the 200 response', async () => {
    const doc = await loadOpenApi();
    const post = batchPost(doc);
    const responses = post === undefined ? undefined : asRecord(post.responses);
    const response = asRecord(responses?.['200']);
    const content = asRecord(response?.content);
    const json = asRecord(content?.['application/json']);
    const schema = asRecord(json?.schema);
    const ref = schema?.$ref;
    expect(ref).toContain('IngestionRequestReceipt');
  });

  it('declares X-Aurora-Environment as a required header parameter', async () => {
    const doc = await loadOpenApi();
    const post = batchPost(doc);
    const serialized = JSON.stringify(post?.parameters);
    expect(serialized).toContain('X-Aurora-Environment');
    expect(serialized).toContain('"required":true');
  });
});
