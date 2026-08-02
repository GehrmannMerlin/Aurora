import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  type ErrorResourceType as ErrorResourceTypeValue,
  type ResourceLoadErrorEventBody,
} from './error-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import { sanitizeHttpUrl } from './safe-url.js';
import type { EventSchemaIssue } from './validation-issues.js';

const RESOURCE_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'resource']);
const RESOURCE_FIELDS: ReadonlySet<string> = new Set(['type', 'url']);
const resourceTypes: ReadonlySet<unknown> = new Set(Object.values(ErrorResourceType));

function parseResourceType(
  input: unknown,
  issues: EventSchemaIssue[],
): ErrorResourceTypeValue | undefined {
  const path = ['body', 'resource', 'type'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Resource type must be a string');
    return undefined;
  }
  if (!resourceTypes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Resource type is not supported');
    return undefined;
  }
  if (input === ErrorResourceType.Script) return ErrorResourceType.Script;
  if (input === ErrorResourceType.Stylesheet) return ErrorResourceType.Stylesheet;
  if (input === ErrorResourceType.Image) return ErrorResourceType.Image;
  return ErrorResourceType.Font;
}

export function parseResourceLoadErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): ResourceLoadErrorEventBody | undefined {
  rejectUnknownFields(input, RESOURCE_BODY_FIELDS, issues, ['body']);
  const resourceField = readRequiredField(input, 'resource', issues, ['body']);
  if (!resourceField.found) return undefined;
  const path = ['body', 'resource'] as const;
  if (!isPlainRecord(resourceField.value)) {
    addValidationIssue(issues, 'invalid_type', path, 'Resource error must be a plain object');
    return undefined;
  }
  rejectUnknownFields(resourceField.value, RESOURCE_FIELDS, issues, path);
  const typeField = readRequiredField(resourceField.value, 'type', issues, path);
  const urlField = readRequiredField(resourceField.value, 'url', issues, path);
  const type = typeField.found ? parseResourceType(typeField.value, issues) : undefined;
  const url = urlField.found
    ? sanitizeHttpUrl(urlField.value, ERROR_EVENT_LIMITS.maxResourceUrlLength, issues, [
        ...path,
        'url',
      ])
    : undefined;
  if (type === undefined || url === undefined) return undefined;
  return { category: ErrorCategory.Resource, resource: { type, url } };
}
