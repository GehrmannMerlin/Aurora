import { EVENT_SCHEMA_LIMITS } from './constants.js';

export type EventSchemaIssueCode =
  | 'missing_required_field'
  | 'invalid_type'
  | 'unknown_field'
  | 'invalid_enum'
  | 'string_too_long'
  | 'array_too_large'
  | 'object_too_large'
  | 'object_too_deep'
  | 'cyclic_reference'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'unknown_event_type'
  | 'unsupported_protocol_version'
  | 'forbidden_field';

export interface EventSchemaIssue {
  readonly code: EventSchemaIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface EventEnvelopeParseFailure {
  readonly success: false;
  readonly issues: readonly EventSchemaIssue[];
}

export function appendIssue(issues: EventSchemaIssue[], issue: EventSchemaIssue): boolean {
  if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return false;
  issues.push(issue);
  return issues.length < EVENT_SCHEMA_LIMITS.maxIssues;
}
