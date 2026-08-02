import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { IngestionBatchRequest, IngestionRequestReceipt } from '../ingestion-types.js';
import { IngestionErrorCode, IngestionReceiptState } from '../ingestion-types.js';

export interface ValidIngestionBatchRequestSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionBatchRequest;
}
export interface ValidIngestionRequestReceiptSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: IngestionRequestReceipt;
}

const singleEvent = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-batch-valid-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_005_100,
  body: {},
} as const;

export const validIngestionBatchRequestSamples: readonly ValidIngestionBatchRequestSample[] = [
  {
    name: 'minimal batch with one event',
    input: { protocolVersion: CURRENT_PROTOCOL_VERSION, events: [singleEvent] },
    expected: { protocolVersion: CURRENT_PROTOCOL_VERSION, events: [singleEvent] },
  },
  {
    name: 'batch with two events and receivedAt',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [singleEvent, { ...singleEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    },
    expected: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [singleEvent, { ...singleEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    },
  },
];

export const validIngestionRequestReceiptSamples: readonly ValidIngestionRequestReceiptSample[] = [
  {
    name: 'request receipt with accepted per-event results',
    input: {
      batchState: IngestionReceiptState.Accepted,
      errorCode: IngestionErrorCode.EventAccepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    },
    expected: {
      batchState: IngestionReceiptState.Accepted,
      errorCode: IngestionErrorCode.EventAccepted,
      retryable: false,
      perEventResults: [
        {
          eventId: 'evt-batch-valid-001',
          state: IngestionReceiptState.Accepted,
          retryable: false,
        },
      ],
    },
  },
  {
    name: 'request receipt with temporarily failed and retryAfterMs',
    input: {
      batchState: IngestionReceiptState.TemporarilyFailed,
      errorCode: IngestionErrorCode.RateLimited,
      retryable: true,
      retryAfterMs: 5_000,
      perEventResults: [],
    },
    expected: {
      batchState: IngestionReceiptState.TemporarilyFailed,
      errorCode: IngestionErrorCode.RateLimited,
      retryable: true,
      retryAfterMs: 5_000,
      perEventResults: [],
    },
  },
];
