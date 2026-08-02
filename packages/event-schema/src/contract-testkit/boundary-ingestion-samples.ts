import type { IngestionBatchRequest, IngestionRequestReceipt } from '../ingestion-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionBatchRequest;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}
export interface BoundaryIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: IngestionRequestReceipt;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

export const boundaryIngestionBatchRequestSamples: readonly BoundaryIngestionBatchRequestSample[] =
  [
    {
      name: 'empty events array is invalid',
      input: { protocolVersion: 1, events: [] },
      isValid: false,
      expectedIssueCode: 'missing_required_field',
    },
    {
      name: 'receivedAt of zero is invalid',
      input: {
        protocolVersion: 1,
        events: [],
        receivedAt: 0,
      },
      isValid: false,
      expectedIssueCode: 'invalid_timestamp',
    },
  ];

export const boundaryIngestionRequestReceiptSamples: readonly BoundaryIngestionRequestReceiptSample[] =
  [
    {
      name: 'empty perEventResults is valid when batch-level covers all',
      input: { batchState: 'accepted', retryable: false, perEventResults: [] },
      isValid: true,
      expected: { batchState: 'accepted', retryable: false, perEventResults: [] },
    },
    {
      name: 'retryAfterMs at the maximum is valid',
      input: {
        batchState: 'temporarily_failed',
        retryable: true,
        retryAfterMs: 86_400_000,
        perEventResults: [],
      },
      isValid: true,
      expected: {
        batchState: 'temporarily_failed',
        retryable: true,
        retryAfterMs: 86_400_000,
        perEventResults: [],
      },
    },
  ];
