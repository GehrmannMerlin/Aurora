import { REQUEST_EVENT_LIMITS } from '../src/index.js';
import { parseRequestEventBody } from '../src/request-event-body.js';
import { describe, expect, it } from 'vitest';

describe('request event body parsing', () => {
  it('parses a minimal successful request', () => {
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1_800_000_005_000,
        durationMs: 120,
        outcome: 'success',
      }),
    ).toEqual({
      success: true,
      data: {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1_800_000_005_000,
        durationMs: 120,
        outcome: 'success',
      },
    });
  });

  it('strips query and fragment from the URL before reading values', () => {
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: 'https://api.example.test/search?token=private#fragment',
        startedAt: 1_800_000_005_001,
        durationMs: 0,
        outcome: 'success',
        statusCode: 200,
      }),
    ).toEqual({
      success: true,
      data: {
        method: 'GET',
        url: 'https://api.example.test/search',
        startedAt: 1_800_000_005_001,
        durationMs: 0,
        outcome: 'success',
        statusCode: 200,
      },
    });
  });

  it('accepts all five outcomes and optional status code absence', () => {
    for (const outcome of ['http_error', 'network_error', 'timeout', 'canceled'] as const) {
      expect(
        parseRequestEventBody({
          method: 'POST',
          url: 'https://api.example.test/actions',
          startedAt: 1_800_000_005_002,
          durationMs: 300,
          outcome,
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    [
      { url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1, outcome: 'success' },
      'missing_required_field',
    ],
    [
      {
        method: 'get',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      },
      'invalid_enum',
    ],
    [{ method: 'GET', url: '', startedAt: 1, durationMs: 1, outcome: 'success' }, 'string_empty'],
    [
      {
        method: 'GET',
        url: 'data:text/plain,synthetic',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      },
      'invalid_url',
    ],
    [
      { method: 'GET', url: '/orders', startedAt: 1, durationMs: 1, outcome: 'success' },
      'invalid_url',
    ],
    [
      { method: 'GET', url: 'https://api.example.test/orders', startedAt: 1, durationMs: 1 },
      'missing_required_field',
    ],
    [
      {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'failed',
      },
      'invalid_enum',
    ],
    [
      {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: -1,
        outcome: 'success',
      },
      'invalid_number',
    ],
    [
      {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
        statusCode: 600,
      },
      'invalid_number',
    ],
    [
      {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 0,
        durationMs: 1,
        outcome: 'success',
      },
      'invalid_timestamp',
    ],
    [
      {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
        page: 'x',
      },
      'unknown_field',
    ],
  ] as const)('rejects invalid body %# with %s', (input, issueCode) => {
    const result = parseRequestEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain(issueCode);
    }
  });

  it('does not modify the input object', () => {
    const input = Object.freeze({
      method: 'GET',
      url: 'https://api.example.test/orders?token=private',
      startedAt: 1_800_000_005_003,
      durationMs: 50,
      outcome: 'success' as const,
    });
    const before = { ...input };
    parseRequestEventBody(input);
    expect(input).toEqual(before);
  });

  it('enforces the URL maximum length boundary', () => {
    const prefix = 'https://api.example.test/';
    const atMaximum = prefix + 'a'.repeat(REQUEST_EVENT_LIMITS.maxRequestUrlLength - prefix.length);
    expect(
      parseRequestEventBody({
        method: 'GET',
        url: atMaximum,
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      }).success,
    ).toBe(true);
    const overMaximum = `${atMaximum}a`;
    const result = parseRequestEventBody({
      method: 'GET',
      url: overMaximum,
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('string_too_long');
    }
  });
});
