import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  invalidIngestionBatchRequestSamples,
  invalidIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('ingestion ingestion contract', () => {
  it('rejects every invalid batch request sample with the expected code', () => {
    for (const sample of invalidIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (result.success) continue;
      expect(
        result.issues.map(({ code }) => code),
        sample.name,
      ).toContain(sample.expectedIssueCode);
    }
  });
  it('rejects every invalid request receipt sample with the expected code', () => {
    for (const sample of invalidIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (result.success) continue;
      expect(
        result.issues.map(({ code }) => code),
        sample.name,
      ).toContain(sample.expectedIssueCode);
    }
  });
});
