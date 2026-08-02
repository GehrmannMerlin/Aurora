import { describe, expect, it } from 'vitest';
import {
  BATCH_EVENT_LIMITS,
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
} from '@aurora/event-schema';
import {
  assertConst,
  assertNumberLimit,
  assertRequiredFields,
  assertType,
  collectDrifts,
  componentSchema,
  loadOpenApiDocument,
  propertySchema,
} from '../src/index.js';

describe('ingestion OpenAPI required and limit drift', () => {
  it('matches IngestionBatchRequest required fields and limits', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionBatchRequest');
    const events = propertySchema(document, 'IngestionBatchRequest', 'events');
    collectDrifts(
      assertType(schema, 'object', 'IngestionBatchRequest'),
      assertRequiredFields(schema, ['protocolVersion', 'events'], 'IngestionBatchRequest'),
      assertNumberLimit(
        events,
        'maxItems',
        BATCH_EVENT_LIMITS.maxEventsPerBatch,
        'IngestionBatchRequest.events',
      ),
      assertNumberLimit(events, 'minItems', 1, 'IngestionBatchRequest.events'),
    );
  });

  it('uses CURRENT_PROTOCOL_VERSION as protocolVersion const', async () => {
    const document = await loadOpenApiDocument();
    const protocolVersion = propertySchema(document, 'IngestionBatchRequest', 'protocolVersion');
    collectDrifts(
      assertConst(
        protocolVersion,
        CURRENT_PROTOCOL_VERSION,
        'IngestionBatchRequest.protocolVersion',
      ),
    );
  });

  it('matches EventEnvelope required fields and eventId length', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'EventEnvelope');
    const eventId = propertySchema(document, 'EventEnvelope', 'eventId');
    collectDrifts(
      assertType(schema, 'object', 'EventEnvelope'),
      assertRequiredFields(
        schema,
        ['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'body'],
        'EventEnvelope',
      ),
      assertNumberLimit(
        eventId,
        'maxLength',
        EVENT_SCHEMA_LIMITS.maxEventIdLength,
        'EventEnvelope.eventId',
      ),
      assertNumberLimit(eventId, 'minLength', 1, 'EventEnvelope.eventId'),
    );
  });

  it('matches IngestionRequestReceipt required fields', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionRequestReceipt');
    collectDrifts(
      assertType(schema, 'object', 'IngestionRequestReceipt'),
      assertRequiredFields(
        schema,
        ['batchState', 'retryable', 'perEventResults'],
        'IngestionRequestReceipt',
      ),
    );
  });

  it('matches IngestionEventReceipt required fields and retryAfterMs ceiling', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionEventReceipt');
    const retryAfterMs = propertySchema(document, 'IngestionEventReceipt', 'retryAfterMs');
    collectDrifts(
      assertType(schema, 'object', 'IngestionEventReceipt'),
      assertRequiredFields(schema, ['eventId', 'state', 'retryable'], 'IngestionEventReceipt'),
      assertNumberLimit(
        retryAfterMs,
        'maximum',
        BATCH_EVENT_LIMITS.maxRetryAfterMs,
        'IngestionEventReceipt.retryAfterMs',
      ),
    );
  });

  it('matches IngestionRequestReceipt retryAfterMs ceiling', async () => {
    const document = await loadOpenApiDocument();
    const retryAfterMs = propertySchema(document, 'IngestionRequestReceipt', 'retryAfterMs');
    collectDrifts(
      assertNumberLimit(
        retryAfterMs,
        'maximum',
        BATCH_EVENT_LIMITS.maxRetryAfterMs,
        'IngestionRequestReceipt.retryAfterMs',
      ),
    );
  });

  it('throws a drift error on an unexpected required field', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionRequestReceipt');
    const drifts = assertRequiredFields(
      schema,
      ['batchState', 'retryable', 'perEventResults', 'extra'],
      'IngestionRequestReceipt',
    );
    expect(drifts.length).toBeGreaterThan(0);
  });
});
