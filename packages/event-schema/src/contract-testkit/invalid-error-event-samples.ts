import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function envelope(body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-error-invalid-synthetic',
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_100,
    body,
  };
}

const cyclic: { self?: unknown } = {};
cyclic.self = cyclic;

export const invalidErrorEventSamples: readonly InvalidErrorEventSample[] = [
  {
    name: 'missing JavaScript message',
    input: envelope({ category: ErrorCategory.JavaScript, error: {} }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'empty JavaScript message',
    input: envelope({ category: ErrorCategory.JavaScript, error: { message: '' } }),
    expectedIssueCode: 'string_empty',
  },
  {
    name: 'unknown body field',
    input: envelope({
      category: ErrorCategory.JavaScript,
      error: { message: 'Synthetic' },
      extra: true,
    }),
    expectedIssueCode: 'unknown_field',
  },
  {
    name: 'unknown error category',
    input: envelope({ category: 'framework', error: { message: 'Synthetic' } }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'missing Promise reason',
    input: envelope({ category: ErrorCategory.UnhandledRejection }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'cyclic Promise reason',
    input: envelope({
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard, value: cyclic },
    }),
    expectedIssueCode: 'cyclic_reference',
  },
  {
    name: 'Promise reason forbidden field',
    input: envelope({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: { authorization: 'synthetic' },
      },
    }),
    expectedIssueCode: 'forbidden_field',
  },
  {
    name: 'unknown resource type',
    input: envelope({
      category: ErrorCategory.Resource,
      resource: { type: 'video', url: 'https://static.example.test/app.mp4' },
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'resource URL has unsupported scheme',
    input: envelope({
      category: ErrorCategory.Resource,
      resource: { type: ErrorResourceType.Image, url: 'data:image/png,synthetic' },
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'error body uses request event type',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId: 'evt-error-invalid-mismatch',
      eventType: EventType.Request,
      occurredAt: 1_800_000_003_101,
      body: { category: ErrorCategory.JavaScript, error: { message: 'Synthetic' } },
    },
    expectedIssueCode: 'event_type_mismatch',
  },
  {
    name: 'unsupported protocol version',
    input: {
      protocolVersion: 2,
      eventId: 'evt-error-invalid-version',
      eventType: EventType.Error,
      occurredAt: 1_800_000_003_102,
      body: { category: ErrorCategory.JavaScript, error: { message: 'Synthetic' } },
    },
    expectedIssueCode: 'unsupported_protocol_version',
  },
];
