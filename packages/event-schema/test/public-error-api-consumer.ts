import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  EventType,
  PromiseRejectionReasonKind,
  type ErrorDescriptor,
  type ErrorEventBody,
  type ErrorEventBodyParseResult,
  type ErrorEventEnvelope,
  type ErrorEventEnvelopeParseResult,
  type ErrorPromiseRejectionReason,
  type JavaScriptErrorEventBody,
  type NonStandardPromiseRejectionReason,
  type PromiseRejectionReason,
  type ResourceLoadError,
  type ResourceLoadErrorEventBody,
  type SafeErrorObject,
  type SafeErrorValue,
  type StringPromiseRejectionReason,
  type UnhandledPromiseRejectionErrorEventBody,
} from '@aurora/event-schema';

const descriptor: ErrorDescriptor = { message: 'Synthetic failure' };
const javascriptBody: JavaScriptErrorEventBody = {
  category: ErrorCategory.JavaScript,
  error: descriptor,
};
const errorReason: ErrorPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.Error,
  error: descriptor,
};
const stringReason: StringPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.String,
  value: 'Synthetic rejection',
};
const safeObject: SafeErrorObject = { attempt: 1, tags: ['synthetic'] };
const safeValue: SafeErrorValue = safeObject;
const nonStandardReason: NonStandardPromiseRejectionReason = {
  kind: PromiseRejectionReasonKind.NonStandard,
  value: safeValue,
};
const reason: PromiseRejectionReason = errorReason;
const promiseBody: UnhandledPromiseRejectionErrorEventBody = {
  category: ErrorCategory.UnhandledRejection,
  reason,
};
const resource: ResourceLoadError = {
  type: ErrorResourceType.Script,
  url: 'https://static.example.test/app.js',
};
const resourceBody: ResourceLoadErrorEventBody = {
  category: ErrorCategory.Resource,
  resource,
};
const body: ErrorEventBody = javascriptBody;
const envelope: ErrorEventEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-public-type-synthetic',
  eventType: EventType.Error,
  occurredAt: 1_800_000_001_000,
  body,
};

export const publicErrorApiConsumer: {
  readonly bodyResult: ErrorEventBodyParseResult | null;
  readonly envelope: ErrorEventEnvelope;
  readonly envelopeResult: ErrorEventEnvelopeParseResult | null;
  readonly limit: number;
  readonly promiseBody: UnhandledPromiseRejectionErrorEventBody;
  readonly resourceBody: ResourceLoadErrorEventBody;
  readonly stringReason: StringPromiseRejectionReason;
  readonly nonStandardReason: NonStandardPromiseRejectionReason;
} = {
  bodyResult: null,
  envelope,
  envelopeResult: null,
  limit: ERROR_EVENT_LIMITS.maxStackLength,
  promiseBody,
  resourceBody,
  stringReason,
  nonStandardReason,
};
