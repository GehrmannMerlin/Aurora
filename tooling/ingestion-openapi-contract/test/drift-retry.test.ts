import { describe, expect, it } from 'vitest';
import { BATCH_EVENT_LIMITS, IngestionReceiptState } from '@aurora/event-schema';
import { componentSchema, loadOpenApiDocument } from '../src/index.js';

async function propertySchema(
  name: string,
  property: string,
): Promise<Readonly<Record<string, unknown>>> {
  const document = await loadOpenApiDocument();
  const schema = componentSchema(document, name);
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error(`${name}.properties is missing`);
  }
  const value = (properties as Readonly<Record<string, unknown>>)[property];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}.${property} is missing`);
  }
  return value as Readonly<Record<string, unknown>>;
}

describe('ingestion OpenAPI retryable and retryAfterMs semantics drift', () => {
  it('declares retryable as boolean in both receipt schemas', async () => {
    for (const name of ['IngestionRequestReceipt', 'IngestionEventReceipt'] as const) {
      const retryable = await propertySchema(name, 'retryable');
      expect(retryable.type, `${name}.retryable.type`).toBe('boolean');
    }
  });

  it('declares retryAfterMs as integer bounded by BATCH_EVENT_LIMITS.maxRetryAfterMs', async () => {
    for (const name of ['IngestionRequestReceipt', 'IngestionEventReceipt'] as const) {
      const retryAfterMs = await propertySchema(name, 'retryAfterMs');
      expect(retryAfterMs.type, `${name}.retryAfterMs.type`).toBe('integer');
      expect(retryAfterMs.minimum, `${name}.retryAfterMs.minimum`).toBe(0);
      expect(retryAfterMs.maximum, `${name}.retryAfterMs.maximum`).toBe(
        BATCH_EVENT_LIMITS.maxRetryAfterMs,
      );
    }
  });

  it('documents permanently_rejected as retryable:false in the protocol (cross-field is runtime enforced)', async () => {
    // OpenAPI does not and must not encode cross-field constraints (state + retryable)
    // — that is a runtime invariant enforced by @aurora/event-schema. This test pins
    // the boundary so a future OpenAPI change does not silently invent such rules.
    const document = await loadOpenApiDocument();
    const states = componentSchema(document, 'IngestionReceiptState');
    expect(states.enum).toContain(IngestionReceiptState.PermanentlyRejected);
    expect(states.enum).toContain(IngestionReceiptState.TemporarilyFailed);
  });

  it('documents Retry-After response header as integer seconds on 429 and 503', async () => {
    const document = await loadOpenApiDocument();
    const paths = document.paths;
    const operation = paths['/v1/batches'] as Readonly<Record<string, unknown>>;
    const post = operation.post as Readonly<Record<string, unknown>>;
    const responses = post.responses as Readonly<Record<string, unknown>>;
    for (const status of ['429', '503'] as const) {
      const response = responses[status] as Readonly<Record<string, unknown>>;
      expect(response, `response ${status}`).toBeDefined();
      const headers = response.headers as Readonly<Record<string, unknown>>;
      expect(headers, `${status} headers`).toBeDefined();
      expect(headers['Retry-After'], `${status} Retry-After`).toBeDefined();
      const headerSchema = (headers['Retry-After'] as Readonly<Record<string, unknown>>)
        .schema as Readonly<Record<string, unknown>>;
      expect(headerSchema.type, `${status} Retry-After type`).toBe('integer');
      expect(headerSchema.minimum, `${status} Retry-After minimum`).toBe(1);
    }
  });
});
