import { EVENT_SCHEMA_LIMITS } from './constants.js';
import { appendIssue, type EventSchemaIssue } from './validation-issues.js';

const FORBIDDEN_FIELD_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'password',
  'requestbody',
  'responsebody',
  'formdata',
  'dom',
  'consolelog',
  'ipaddress',
]);

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): boolean {
  return appendIssue(issues, { code, path: [...path], message });
}

function visitValue(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
  depth: number,
  ancestors: ReadonlySet<object>,
): void {
  if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
  if (depth > EVENT_SCHEMA_LIMITS.maxObjectDepth) {
    addIssue(issues, 'object_too_deep', path, 'Event body exceeds maximum object depth');
    return;
  }
  if (input === null || typeof input === 'boolean') return;
  if (typeof input === 'string') {
    if (input.length > EVENT_SCHEMA_LIMITS.maxStringLength) {
      addIssue(issues, 'string_too_long', path, 'Event body string exceeds maximum length');
    }
    return;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      addIssue(issues, 'invalid_number', path, 'Event body number must be finite');
    }
    return;
  }
  if (typeof input !== 'object') {
    addIssue(issues, 'invalid_type', path, 'Event body contains a non-JSON value');
    return;
  }
  if (ancestors.has(input)) {
    addIssue(issues, 'cyclic_reference', path, 'Event body must not contain a cycle');
    return;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(input);

  if (Array.isArray(input)) {
    if (input.length > EVENT_SCHEMA_LIMITS.maxArrayLength) {
      addIssue(issues, 'array_too_large', path, 'Event body array exceeds maximum length');
      return;
    }
    for (const [index, value] of input.entries()) {
      visitValue(value, issues, [...path, index], depth + 1, nextAncestors);
      if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
    }
    return;
  }

  if (!isPlainObject(input)) {
    addIssue(issues, 'invalid_type', path, 'Event body object must be a plain JSON object');
    return;
  }
  const keys = Object.keys(input).sort();
  if (keys.length > EVENT_SCHEMA_LIMITS.maxObjectKeys) {
    addIssue(issues, 'object_too_large', path, 'Event body object exceeds maximum key count');
    return;
  }
  for (const key of keys) {
    const childPath = [...path, key];
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
      if (
        !addIssue(issues, 'forbidden_field', childPath, 'Event body contains a forbidden field')
      ) {
        return;
      }
      continue;
    }
    visitValue(input[key], issues, childPath, depth + 1, nextAncestors);
    if (issues.length >= EVENT_SCHEMA_LIMITS.maxIssues) return;
  }
}

export function validateBodyValue(input: unknown, issues: EventSchemaIssue[]): void {
  visitValue(input, issues, ['body'], 0, new Set());
}
