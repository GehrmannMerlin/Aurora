import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

function resourceBody(type: unknown, url: unknown): unknown {
  return { category: ErrorCategory.Resource, resource: { type, url } };
}

describe('resource-load error body', () => {
  it.each(Object.values(ErrorResourceType))('accepts resource type %s', (type) => {
    expect(
      parseErrorEventBody(resourceBody(type, 'https://static.example.test/app.js')).success,
    ).toBe(true);
  });

  it('removes the complete query and fragment without modifying input', () => {
    const input = {
      category: ErrorCategory.Resource,
      resource: {
        type: ErrorResourceType.Script,
        url: 'https://static.example.test/app.js?token=synthetic#fragment',
      },
    };
    const result = parseErrorEventBody(input);
    expect(result).toEqual({
      success: true,
      data: {
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Script,
          url: 'https://static.example.test/app.js',
        },
      },
    });
    expect(input.resource.url).toContain('?token=synthetic');
    if (result.success && result.data.category === ErrorCategory.Resource) {
      expect(result.data).not.toBe(input);
      expect(result.data.resource).not.toBe(input.resource);
    }
  });

  it('accepts an exact maximum URL and rejects one unit over', () => {
    const prefix = 'https://static.example.test/';
    const maximum = prefix + 'a'.repeat(ERROR_EVENT_LIMITS.maxResourceUrlLength - prefix.length);
    expect(parseErrorEventBody(resourceBody(ErrorResourceType.Image, maximum)).success).toBe(true);
    expect(issueCodes(resourceBody(ErrorResourceType.Image, `${maximum}a`))).toContain(
      'string_too_long',
    );
  });

  it.each([
    'data:text/plain,synthetic',
    'blob:https://static.example.test/synthetic',
    'file:///synthetic/app.js',
    '/relative/app.js',
    'HTTPS://static.example.test/app.js',
    'https:///app.js',
    'https://user:pass@static.example.test/app.js',
    'https://static.example.test:99999/app.js',
    'https://static.example.test\\app.js',
    'https://static.example.test/app file.js',
  ])('rejects unsafe URL %s', (url) => {
    expect(issueCodes(resourceBody(ErrorResourceType.Script, url))).toContain('invalid_url');
  });

  it('rejects missing URL, wrong URL type, unknown resource type, and unknown fields', () => {
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        resource: { type: ErrorResourceType.Script },
      }),
    ).toContain('missing_required_field');
    expect(issueCodes(resourceBody(ErrorResourceType.Script, null))).toContain('invalid_type');
    expect(issueCodes(resourceBody('video', 'https://static.example.test/app.mp4'))).toContain(
      'invalid_enum',
    );
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        extra: true,
        resource: {
          type: ErrorResourceType.Font,
          url: 'https://static.example.test/font.woff2',
        },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Font,
          url: 'https://static.example.test/font.woff2',
          element: 'link',
        },
      }),
    ).toContain('unknown_field');
  });
});
