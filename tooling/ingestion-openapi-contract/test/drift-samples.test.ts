import { describe, expect, it } from 'vitest';
import {
  boundaryIngestionBatchRequestSamples,
  boundaryIngestionRequestReceiptSamples,
  validIngestionBatchRequestSamples,
  validIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { loadOpenApiDocument, schemaEnum, schemaRequired, componentSchema } from '../src/index.js';

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectAllowedFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    expect(allowed, `${label} field ${key}`).toContain(key);
  }
}

function expectEnumValue(value: unknown, enumValues: readonly unknown[], label: string): void {
  expect(enumValues.map(String), `${label} enum`).toContain(String(value));
}

function validateEventEnvelope(envelope: unknown, label: string): void {
  expect(isPlainRecord(envelope), `${label} must be a plain object`).toBe(true);
  if (!isPlainRecord(envelope)) return;
  expectAllowedFields(
    envelope,
    ['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'body'],
    label,
  );
  expect(envelope.protocolVersion, `${label}.protocolVersion`).toBe(1);
  expect(typeof envelope.eventId, `${label}.eventId`).toBe('string');
  expect(typeof envelope.occurredAt, `${label}.occurredAt`).toBe('number');
  expect(isPlainRecord(envelope.body), `${label}.body must be an object`).toBe(true);
}

function validateEventReceipt(receipt: Readonly<Record<string, unknown>>, label: string): void {
  expectAllowedFields(
    receipt,
    ['eventId', 'state', 'errorCode', 'retryable', 'retryAfterMs'],
    label,
  );
  expect(typeof receipt.eventId, `${label}.eventId`).toBe('string');
  expect(typeof receipt.retryable, `${label}.retryable`).toBe('boolean');
  if (receipt.retryAfterMs !== undefined) {
    expect(typeof receipt.retryAfterMs, `${label}.retryAfterMs`).toBe('number');
  }
}

describe('ingestion OpenAPI valid sample drift', () => {
  it('accepts every valid batch request sample under the OpenAPI schema shape', async () => {
    const document = await loadOpenApiDocument();
    const batchSchema = componentSchema(document, 'IngestionBatchRequest');
    const required = schemaRequired(batchSchema);
    const eventTypeSchema = componentSchema(document, 'EventType');
    const eventTypes = schemaEnum(eventTypeSchema);

    for (const sample of validIngestionBatchRequestSamples) {
      const value = sample.expected;
      expect(isPlainRecord(value), `${sample.name}: batch must be object`).toBe(true);
      if (!isPlainRecord(value)) continue;
      for (const field of required) {
        expect(value, `${sample.name}: missing required field ${field}`).toHaveProperty(field);
      }
      expectAllowedFields(value, ['protocolVersion', 'events', 'receivedAt'], sample.name);
      expect(value.protocolVersion, `${sample.name}.protocolVersion`).toBe(1);
      expect(Array.isArray(value.events), `${sample.name}.events array`).toBe(true);
      expect(
        (value.events as readonly unknown[]).length,
        `${sample.name}.events length`,
      ).toBeGreaterThan(0);
      for (const [index, envelope] of (value.events as readonly unknown[]).entries()) {
        const position = String(index);
        validateEventEnvelope(envelope, `${sample.name}.events[${position}]`);
        if (isPlainRecord(envelope)) {
          expectEnumValue(
            envelope.eventType,
            eventTypes,
            `${sample.name}.events[${position}].eventType`,
          );
        }
      }
    }
  });

  it('accepts every valid request receipt sample under the OpenAPI schema shape', async () => {
    const document = await loadOpenApiDocument();
    const requestSchema = componentSchema(document, 'IngestionRequestReceipt');
    const required = schemaRequired(requestSchema);
    const stateSchema = componentSchema(document, 'IngestionReceiptState');
    const states = schemaEnum(stateSchema);

    for (const sample of validIngestionRequestReceiptSamples) {
      const value = sample.expected;
      expect(isPlainRecord(value), `${sample.name}: receipt must be object`).toBe(true);
      if (!isPlainRecord(value)) continue;
      for (const field of required) {
        expect(value, `${sample.name}: missing required field ${field}`).toHaveProperty(field);
      }
      expectAllowedFields(
        value,
        ['batchState', 'errorCode', 'retryable', 'retryAfterMs', 'perEventResults'],
        sample.name,
      );
      expectEnumValue(value.batchState, states, `${sample.name}.batchState`);
      expect(typeof value.retryable, `${sample.name}.retryable`).toBe('boolean');
      expect(Array.isArray(value.perEventResults), `${sample.name}.perEventResults`).toBe(true);
      for (const [index, eventResult] of (value.perEventResults as readonly unknown[]).entries()) {
        const position = String(index);
        expect(isPlainRecord(eventResult), `${sample.name}.perEventResults[${position}]`).toBe(
          true,
        );
        if (!isPlainRecord(eventResult)) continue;
        validateEventReceipt(eventResult, `${sample.name}.perEventResults[${position}]`);
        expectEnumValue(
          eventResult.state,
          states,
          `${sample.name}.perEventResults[${position}].state`,
        );
      }
    }
  });
});

describe('ingestion OpenAPI boundary sample drift', () => {
  it('keeps boundary batch samples consistent between event-schema and OpenAPI shape', async () => {
    const document = await loadOpenApiDocument();
    const batchSchema = componentSchema(document, 'IngestionBatchRequest');
    const required = schemaRequired(batchSchema);

    for (const sample of boundaryIngestionBatchRequestSamples) {
      const value = sample.input;
      const shapeValid =
        isPlainRecord(value) &&
        required.every((field) => field in value) &&
        Array.isArray(value.events) &&
        (value.events as readonly unknown[]).length > 0 &&
        (value.events as readonly unknown[]).length <= 50 &&
        (value.events as readonly unknown[]).every(
          (envelope) =>
            isPlainRecord(envelope) &&
            envelope.protocolVersion === 1 &&
            typeof envelope.eventId === 'string' &&
            typeof envelope.occurredAt === 'number' &&
            isPlainRecord(envelope.body),
        );
      expect(shapeValid, `${sample.name}: shape validity ${String(sample.isValid)}`).toBe(
        sample.isValid,
      );
    }
  });

  it('keeps boundary request receipt samples consistent between contracts', async () => {
    const document = await loadOpenApiDocument();
    const requestSchema = componentSchema(document, 'IngestionRequestReceipt');
    const required = schemaRequired(requestSchema);
    const stateSchema = componentSchema(document, 'IngestionReceiptState');
    const states = schemaEnum(stateSchema);

    for (const sample of boundaryIngestionRequestReceiptSamples) {
      const value = sample.input;
      const shapeValid =
        isPlainRecord(value) &&
        required.every((field) => field in value) &&
        states.map(String).includes(String(value.batchState)) &&
        typeof value.retryable === 'boolean' &&
        Array.isArray(value.perEventResults) &&
        (value.perEventResults as readonly unknown[]).every((item) => isPlainRecord(item));
      expect(shapeValid, `${sample.name}: shape validity ${String(sample.isValid)}`).toBe(
        sample.isValid,
      );
    }
  });
});
