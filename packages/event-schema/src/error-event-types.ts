import type { EventEnvelope } from './event-envelope.js';
import type { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const ErrorCategory = {
  JavaScript: 'javascript',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const PromiseRejectionReasonKind = {
  Error: 'error',
  String: 'string',
  NonStandard: 'non_standard',
} as const;

export type PromiseRejectionReasonKind =
  (typeof PromiseRejectionReasonKind)[keyof typeof PromiseRejectionReasonKind];

export const ErrorResourceType = {
  Script: 'script',
  Stylesheet: 'stylesheet',
  Image: 'image',
  Font: 'font',
} as const;

export type ErrorResourceType = (typeof ErrorResourceType)[keyof typeof ErrorResourceType];

export const ERROR_EVENT_LIMITS = {
  maxErrorNameLength: 128,
  maxErrorMessageLength: 2048,
  maxStackLength: 4096,
  maxResourceUrlLength: 2048,
  maxRejectionStringLength: 2048,
} as const;

export interface ErrorDescriptor {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface JavaScriptErrorEventBody {
  readonly category: typeof ErrorCategory.JavaScript;
  readonly error: ErrorDescriptor;
}

export interface ErrorPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.Error;
  readonly error: ErrorDescriptor;
}

export interface StringPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.String;
  readonly value: string;
}

export interface SafeErrorObject {
  readonly [key: string]: SafeErrorValue;
}

export type SafeErrorValue =
  null | boolean | number | string | readonly SafeErrorValue[] | SafeErrorObject;

export interface NonStandardPromiseRejectionReason {
  readonly kind: typeof PromiseRejectionReasonKind.NonStandard;
  readonly value: SafeErrorValue;
}

export type PromiseRejectionReason =
  ErrorPromiseRejectionReason | StringPromiseRejectionReason | NonStandardPromiseRejectionReason;

export interface UnhandledPromiseRejectionErrorEventBody {
  readonly category: typeof ErrorCategory.UnhandledRejection;
  readonly reason: PromiseRejectionReason;
}

export interface ResourceLoadError {
  readonly type: ErrorResourceType;
  readonly url: string;
}

export interface ResourceLoadErrorEventBody {
  readonly category: typeof ErrorCategory.Resource;
  readonly resource: ResourceLoadError;
}

export type ErrorEventBody =
  JavaScriptErrorEventBody | UnhandledPromiseRejectionErrorEventBody | ResourceLoadErrorEventBody;

export type ErrorEventEnvelope = EventEnvelope & {
  readonly eventType: typeof EventType.Error;
  readonly body: ErrorEventBody;
};

export interface ErrorEventBodyParseSuccess {
  readonly success: true;
  readonly data: ErrorEventBody;
}

export type ErrorEventBodyParseFailure = EventEnvelopeParseFailure;
export type ErrorEventBodyParseResult = ErrorEventBodyParseSuccess | ErrorEventBodyParseFailure;

export interface ErrorEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: ErrorEventEnvelope;
}

export type ErrorEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type ErrorEventEnvelopeParseResult =
  ErrorEventEnvelopeParseSuccess | ErrorEventEnvelopeParseFailure;
