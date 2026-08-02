import { addValidationIssue, parseBoundedString } from './field-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

function containsUnsafeUrlCharacter(input: string): boolean {
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code === 0x5c || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const safeAuthority =
  /^(?:\[[0-9A-Fa-f:.]+\]|localhost|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::([0-9]{1,5}))?$/u;

function firstUrlSuffixIndex(input: string): number {
  const queryIndex = input.indexOf('?');
  const fragmentIndex = input.indexOf('#');
  if (queryIndex < 0) return fragmentIndex;
  if (fragmentIndex < 0) return queryIndex;
  return Math.min(queryIndex, fragmentIndex);
}

export function sanitizeHttpUrl(
  input: unknown,
  maxLength: number,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): string | undefined {
  const bounded = parseBoundedString(input, maxLength, issues, path);
  if (bounded === undefined) return undefined;
  const suffixIndex = firstUrlSuffixIndex(bounded);
  const sanitized = suffixIndex < 0 ? bounded : bounded.slice(0, suffixIndex);
  const schemeLength = sanitized.startsWith('https://')
    ? 'https://'.length
    : sanitized.startsWith('http://')
      ? 'http://'.length
      : 0;
  const pathIndex = sanitized.indexOf('/', schemeLength);
  const authority = sanitized.slice(schemeLength, pathIndex < 0 ? sanitized.length : pathIndex);
  const authorityMatch = safeAuthority.exec(authority);
  const portText = authorityMatch?.[1];
  if (
    schemeLength === 0 ||
    authority.length === 0 ||
    authority.includes('@') ||
    containsUnsafeUrlCharacter(sanitized) ||
    authorityMatch === null ||
    (portText !== undefined && Number(portText) > 65_535)
  ) {
    addValidationIssue(issues, 'invalid_url', path, 'URL is not a safe HTTP URL');
    return undefined;
  }
  return sanitized;
}
