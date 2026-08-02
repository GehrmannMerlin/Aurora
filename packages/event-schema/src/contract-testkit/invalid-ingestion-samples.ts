import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}
export interface InvalidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

export const invalidIngestionBatchRequestSamples: readonly InvalidIngestionBatchRequestSample[] = [
  {
    name: 'unsupported protocol version',
    input: { protocolVersion: 2, events: [] },
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'empty events array',
    input: { protocolVersion: 1, events: [] },
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'events not an array',
    input: { protocolVersion: 1, events: 'not-array' },
    expectedIssueCode: 'invalid_type',
  },
  {
    name: 'event element not a plain envelope',
    input: { protocolVersion: 1, events: [{ protocolVersion: 1 }] },
    expectedIssueCode: 'missing_required_field',
  },
];

export const invalidIngestionRequestReceiptSamples: readonly InvalidIngestionRequestReceiptSample[] =
  [
    {
      name: 'unknown batch state',
      input: { batchState: 'unknown', retryable: false, perEventResults: [] },
      expectedIssueCode: 'invalid_enum',
    },
    {
      name: 'retryable not boolean',
      input: { batchState: 'accepted', retryable: 'yes', perEventResults: [] },
      expectedIssueCode: 'invalid_type',
    },
    {
      name: 'negative retryAfterMs',
      input: {
        batchState: 'temporarily_failed',
        retryable: true,
        retryAfterMs: -1,
        perEventResults: [],
      },
      expectedIssueCode: 'invalid_number',
    },
    {
      name: 'missing perEventResults',
      input: { batchState: 'accepted', retryable: false },
      expectedIssueCode: 'missing_required_field',
    },
  ];
