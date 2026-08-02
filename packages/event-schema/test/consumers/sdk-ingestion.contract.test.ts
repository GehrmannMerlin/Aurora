import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  validIngestionBatchRequestSamples,
  validIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('SDK ingestion contract', () => {
  it('accepts every valid batch request sample', () => {
    for (const sample of validIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      expect(result.success, sample.name).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sample.expected);
      }
    }
  });
  it('accepts every valid request receipt sample', () => {
    for (const sample of validIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      expect(result.success, sample.name).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sample.expected);
      }
    }
  });
});
