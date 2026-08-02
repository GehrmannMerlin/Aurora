import { parseIngestionBatchRequest, parseIngestionRequestReceipt } from '@aurora/event-schema';
import {
  boundaryIngestionBatchRequestSamples,
  boundaryIngestionRequestReceiptSamples,
} from '@aurora/event-schema/contract-testkit';
import { describe, expect, it } from 'vitest';

describe('processing ingestion contract', () => {
  it('accepts valid and rejects invalid boundary batch samples', () => {
    for (const sample of boundaryIngestionBatchRequestSamples) {
      const result = parseIngestionBatchRequest(sample.input);
      if (sample.isValid) {
        expect(result.success, sample.name).toBe(true);
      } else {
        expect(result.success, sample.name).toBe(false);
        if (result.success) continue;
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
  it('accepts valid and rejects invalid boundary receipt samples', () => {
    for (const sample of boundaryIngestionRequestReceiptSamples) {
      const result = parseIngestionRequestReceipt(sample.input);
      if (sample.isValid) {
        expect(result.success, sample.name).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(sample.expected);
        }
      } else {
        expect(result.success, sample.name).toBe(false);
        if (result.success) continue;
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
