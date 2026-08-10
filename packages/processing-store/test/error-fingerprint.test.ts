import { describe, expect, it } from 'vitest';
import type { ErrorEventBody } from '@aurora/event-schema';
import {
  ERROR_FINGERPRINT_VERSION,
  computeErrorFingerprint,
} from '../src/index.js';

const js = (over: { name?: string; message: string; stack?: string }): ErrorEventBody => ({
  category: 'javascript',
  error: {
    ...(over.name === undefined ? {} : { name: over.name }),
    message: over.message,
    ...(over.stack === undefined ? {} : { stack: over.stack }),
  },
});

describe('computeErrorFingerprint', () => {
  it('pins the fingerprint version to 1', () => {
    expect(ERROR_FINGERPRINT_VERSION).toBe(1);
  });

  it('is deterministic for identical input', () => {
    const body = js({
      name: 'TypeError',
      message: 'order 202607250001 failed',
      stack: 'at f (https://cdn.test/app.js:42:5)',
    });
    const a = computeErrorFingerprint({ projectId: 'p', body });
    const b = computeErrorFingerprint({ projectId: 'p', body });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprintVersion).toBe(1);
    expect(a.normalizedTitle).toBe(b.normalizedTitle);
  });

  it('groups equivalent errors differing only in dynamic values', () => {
    const body1 = js({
      name: 'TypeError',
      message: 'order 202607250001 failed',
      stack: 'at f (https://cdn.test/app.js:42:5)',
    });
    const body2 = js({
      name: 'TypeError',
      message: 'order 202607250999 failed',
      stack: 'at f (https://cdn.test/app.js:42:5)',
    });
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint).toBe(
      computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint,
    );
  });

  it('separates intentionally different errors', () => {
    const body1 = js({
      name: 'TypeError',
      message: 'x is not a function',
      stack: 'at f (https://cdn.test/app.js:42:5)',
    });
    const body2 = js({
      name: 'ReferenceError',
      message: 'x is not a function',
      stack: 'at f (https://cdn.test/app.js:42:5)',
    });
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint).not.toBe(
      computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint,
    );
  });

  it('preserves status codes/versions/retry counts and replaces UUID/hash/long digits', () => {
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({
        name: 'Error',
        message: 'HTTP 404 version 1.4.3 uuid 550e8400-e29b-41d4-a716-446655440000 retry 2',
      }),
    });
    expect(result.fingerprint).toContain('HTTP 404');
    expect(result.fingerprint).toContain('1.4.3');
    expect(result.fingerprint).toContain('retry 2');
    expect(result.fingerprint).toContain(':uuid');
    expect(result.fingerprint).not.toContain('550e8400');
  });

  it('omits keyLocation when stack is absent', () => {
    const withStack = computeErrorFingerprint({
      projectId: 'p',
      body: js({ name: 'Error', message: 'boom', stack: 'at f (https://cdn.test/app.js:1:1)' }),
    });
    const noStack = computeErrorFingerprint({
      projectId: 'p',
      body: js({ name: 'Error', message: 'boom' }),
    });
    expect(withStack.fingerprint).not.toBe(noStack.fingerprint);
    expect(noStack.fingerprint).toBe('v1|Error|boom');
  });

  it('privacy-negative: fingerprint never contains raw email/phone/uuid/long token', () => {
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({
        name: 'Error',
        message: 'user a@b.com 13800138000 550e8400-e29b-41d4-a716-446655440000 token aB3x9Q2mN7vR5tW8zK1pL4cJ6hS0dF2',
      }),
    });
    expect(result.fingerprint).not.toMatch(/a@b\.com|13800138000|550e8400|aB3x9Q2mN7vR5tW8/);
    expect(result.normalizedTitle).not.toMatch(/a@b\.com|13800138000/);
  });

  it('strips query/fragment and excludes scheme/authority from stack frame file', () => {
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({
        name: 'Error',
        message: 'boom',
        stack: 'at f (https://cdn.test/app.js?session=abc#frag:10:2)',
      }),
    });
    expect(result.fingerprint).toContain('app.js:10');
    expect(result.fingerprint).not.toContain('session=abc');
    expect(result.fingerprint).not.toContain('https://');
  });

  it('falls back to category placeholder when name is missing', () => {
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({ message: 'boom' }),
    });
    expect(result.fingerprint).toBe('v1|js_error|boom');
  });

  it('resource errors use resource type and normalized URL path', () => {
    const body: ErrorEventBody = {
      category: 'resource',
      resource: { type: 'script', url: 'https://static.example.test/app.js?cache=abc#x' },
    };
    const result = computeErrorFingerprint({ projectId: 'p', body });
    expect(result.fingerprint).toBe('v1|script|app.js');
    expect(result.fingerprint).not.toContain('cache=abc');
    expect(result.fingerprint).not.toContain('https://');
  });

  it('string rejection reasons are normalized deterministically', () => {
    const body1: ErrorEventBody = {
      category: 'unhandled_rejection',
      reason: { kind: 'string', value: 'fetch failed for user 550e8400-e29b-41d4-a716-446655440000' },
    };
    const body2: ErrorEventBody = {
      category: 'unhandled_rejection',
      reason: { kind: 'string', value: 'fetch failed for user 550e8400-e29b-41d4-a716-446655440099' },
    };
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint).toBe(
      computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint,
    );
  });

  it('bounds the fingerprint to 1024 chars even for very long stack frame files', () => {
    const longPath = 'static/js/' + 'very-long-path-segment-'.repeat(40) + '/app.js';
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({
        name: 'Error',
        message: 'boom',
        stack: 'at f (https://cdn.test/' + longPath + ':123:4)',
      }),
    });
    expect(result.fingerprint.length).toBeLessThanOrEqual(1024);
    expect(result.fingerprint).toContain(':truncated');
  });

  it('preserves dotted version numbers and short numbers (does not over-normalize)', () => {
    const result = computeErrorFingerprint({
      projectId: 'p',
      body: js({ name: 'Error', message: 'failed at 1.2.3 endpoint /api/items count 7' }),
    });
    expect(result.fingerprint).toContain('1.2.3');
    expect(result.fingerprint).toContain('7');
  });

  it('non-standard rejection reasons produce a deterministic canonical projection', () => {
    const body1: ErrorEventBody = {
      category: 'unhandled_rejection',
      reason: { kind: 'non_standard', value: { status: 500, message: 'boom 202607250001' } },
    };
    const body2: ErrorEventBody = {
      category: 'unhandled_rejection',
      reason: { kind: 'non_standard', value: { message: 'boom 202607250999', status: 500 } },
    };
    expect(computeErrorFingerprint({ projectId: 'p', body: body1 }).fingerprint).toBe(
      computeErrorFingerprint({ projectId: 'p', body: body2 }).fingerprint,
    );
  });
});
