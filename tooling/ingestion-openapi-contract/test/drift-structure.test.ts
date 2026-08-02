import { describe, expect, it } from 'vitest';
import { loadOpenApiDocument, operationResponses } from '../src/index.js';

const ALL_REQUIRED_STATUS_CODES = ['200', '400', '401', '403', '413', '415', '429', '500', '503'];

describe('ingestion OpenAPI structure', () => {
  it('declares OpenAPI 3.1.0 with stable info', async () => {
    const document = await loadOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toContain('Ingestion');
    expect(document.info.version).toBe('1.0.0');
  });

  it('declares exactly one path /v1/batches with a POST operationId ingestionSubmitBatch', async () => {
    const document = await loadOpenApiDocument();
    const paths = document.paths;
    expect(Object.keys(paths)).toEqual(['/v1/batches']);
    const operation = paths['/v1/batches'] as Readonly<Record<string, unknown>>;
    expect(operation.post).toBeDefined();
    const post = operation.post as Readonly<Record<string, unknown>>;
    expect(post.operationId).toBe('ingestionSubmitBatch');
  });

  it('sets no servers (host is deployment-config supplied)', async () => {
    const document = await loadOpenApiDocument();
    expect(document).not.toHaveProperty('servers');
  });

  it('declares every required HTTP status code with a body', async () => {
    const document = await loadOpenApiDocument();
    const responses = operationResponses(document, '/v1/batches', 'post');
    for (const status of ALL_REQUIRED_STATUS_CODES) {
      expect(responses[status], `response ${status}`).toBeDefined();
      expect(
        (responses[status] as Readonly<Record<string, unknown>>).content,
        `response ${status} content`,
      ).toBeDefined();
    }
  });

  it('declares Retry-After only on 429 and 503', async () => {
    const document = await loadOpenApiDocument();
    const responses = operationResponses(document, '/v1/batches', 'post');
    for (const [status, response] of Object.entries(responses)) {
      const headers = (response as Readonly<Record<string, unknown>>).headers as
        Readonly<Record<string, unknown>> | undefined;
      const hasRetryAfter = headers?.['Retry-After'] !== undefined;
      if (status === '429' || status === '503') {
        expect(hasRetryAfter, `Retry-After present on ${status}`).toBe(true);
      } else {
        expect(hasRetryAfter, `no Retry-After on ${status}`).toBe(false);
      }
    }
  });

  it('uses IngestionRequestReceipt for 200, 429, 503 and ErrorResponse for request-level errors', async () => {
    const document = await loadOpenApiDocument();
    const responses = operationResponses(document, '/v1/batches', 'post');
    const receiptFor = new Set(['200', '429', '503']);
    const errorFor = new Set(['400', '401', '403', '413', '415', '500']);
    for (const status of receiptFor) {
      const schema = (responses[status] as Readonly<Record<string, unknown>>).content as Readonly<
        Record<string, unknown>
      >;
      const applicationJson = schema['application/json'] as Readonly<Record<string, unknown>>;
      const ref = (applicationJson.schema as Readonly<Record<string, unknown>>).$ref as string;
      expect(ref, `200/429/503 schema ${status}`).toContain('IngestionRequestReceipt');
    }
    for (const status of errorFor) {
      const schema = (responses[status] as Readonly<Record<string, unknown>>).content as Readonly<
        Record<string, unknown>
      >;
      const applicationJson = schema['application/json'] as Readonly<Record<string, unknown>>;
      const ref = (applicationJson.schema as Readonly<Record<string, unknown>>).$ref as string;
      expect(ref, `error schema ${status}`).toContain('ErrorResponse');
    }
  });

  it('declares all eight component schemas with stable names', async () => {
    const document = await loadOpenApiDocument();
    for (const name of [
      'IngestionBatchRequest',
      'EventEnvelope',
      'EventType',
      'IngestionRequestReceipt',
      'IngestionEventReceipt',
      'IngestionReceiptState',
      'IngestionErrorCode',
      'ErrorResponse',
    ]) {
      expect(document.components.schemas?.[name], `schema ${name}`).toBeDefined();
    }
  });
});
