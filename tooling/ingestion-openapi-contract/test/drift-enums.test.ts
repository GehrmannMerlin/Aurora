import { describe, expect, it } from 'vitest';
import { IngestionErrorCode, IngestionReceiptState } from '@aurora/event-schema';
import {
  assertEnumMatches,
  collectDrifts,
  componentSchema,
  loadOpenApiDocument,
} from '../src/index.js';

describe('ingestion OpenAPI enum drift', () => {
  it('matches IngestionReceiptState enum exactly', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionReceiptState');
    collectDrifts(
      assertEnumMatches(schema, Object.values(IngestionReceiptState), 'IngestionReceiptState'),
    );
  });

  it('matches IngestionErrorCode enum exactly', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionErrorCode');
    collectDrifts(
      assertEnumMatches(schema, Object.values(IngestionErrorCode), 'IngestionErrorCode'),
    );
  });

  it('matches EventType enum exactly', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'EventType');
    const expected = ['error', 'request', 'performance'];
    collectDrifts(assertEnumMatches(schema, expected, 'EventType'));
  });

  it('exposes every receipt state value at least once in examples', async () => {
    const document = await loadOpenApiDocument();
    const examples = document.components.examples ?? {};
    const serialized = JSON.stringify(examples);
    for (const state of Object.values(IngestionReceiptState)) {
      expect(serialized, `example coverage for ${state}`).toContain(state);
    }
  });

  it('throws a drift error when enum values diverge', async () => {
    const document = await loadOpenApiDocument();
    const schema = componentSchema(document, 'IngestionReceiptState');
    const drifts = assertEnumMatches(schema, ['accepted', 'bogus_state'], 'IngestionReceiptState');
    expect(drifts.length).toBeGreaterThan(0);
  });
});
