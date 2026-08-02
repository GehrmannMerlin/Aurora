import type { EventEnvelope } from './event-envelope.js';
import type { ProtocolVersion } from './constants.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const BATCH_EVENT_LIMITS = Object.freeze({
  maxEventsPerBatch: 50,
  maxEventIdLength: 128,
  maxErrorCodeLength: 64,
  maxRetryAfterMs: 86400000,
} as const);

export const IngestionReceiptState = Object.freeze({
  Accepted: 'accepted',
  DuplicateAccepted: 'duplicate_accepted',
  PermanentlyRejected: 'permanently_rejected',
  TemporarilyFailed: 'temporarily_failed',
} as const);
export type IngestionReceiptState =
  (typeof IngestionReceiptState)[keyof typeof IngestionReceiptState];

export const IngestionErrorCode = Object.freeze({
  BatchAccepted: 'batch_accepted',
  EventAccepted: 'event_accepted',
  DuplicateAccepted: 'duplicate_accepted',
  UnsupportedProtocolVersion: 'unsupported_protocol_version',
  InvalidSchema: 'invalid_schema',
  FieldExceedsLimit: 'field_exceeds_limit',
  ForbiddenField: 'forbidden_field',
  InvalidEventType: 'invalid_event_type',
  ProjectPermanentlyNotAllowed: 'project_permanently_not_allowed',
  SourcePermanentlyNotAllowed: 'source_permanently_not_allowed',
  ServiceTemporarilyUnavailable: 'service_temporarily_unavailable',
  RateLimited: 'rate_limited',
  CapacityProtected: 'capacity_protected',
} as const);
export type IngestionErrorCode = (typeof IngestionErrorCode)[keyof typeof IngestionErrorCode];

export interface IngestionBatchRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly events: readonly EventEnvelope[];
  readonly receivedAt?: number;
}

export interface IngestionEventReceipt {
  readonly eventId: string;
  readonly state: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface IngestionRequestReceipt {
  readonly batchState: IngestionReceiptState;
  readonly errorCode?: IngestionErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly perEventResults: readonly IngestionEventReceipt[];
}

export type IngestionBatchRequestParseFailure = EventEnvelopeParseFailure;
export type IngestionBatchRequestParseResult =
  | { readonly success: true; readonly data: IngestionBatchRequest }
  | IngestionBatchRequestParseFailure;

export type IngestionRequestReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionRequestReceiptParseResult =
  | { readonly success: true; readonly data: IngestionRequestReceipt }
  | IngestionRequestReceiptParseFailure;

export type IngestionEventReceiptParseFailure = EventEnvelopeParseFailure;
export type IngestionEventReceiptParseResult =
  | { readonly success: true; readonly data: IngestionEventReceipt }
  | IngestionEventReceiptParseFailure;
