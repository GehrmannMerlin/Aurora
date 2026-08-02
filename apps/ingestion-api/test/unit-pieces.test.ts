import { describe, expect, it } from 'vitest';
import { defaultRequestIdProvider } from '../src/request-id.js';
import { validatePreflightOrigin, isPreflightAllowed } from '../src/cors.js';
import { mapPersistResultsToEventReceipts } from '../src/receipt-mapper.js';
import { mapErrorToHttp, retryAfterSeconds } from '../src/error-mapper.js';
import { IngestionInboxError } from '@aurora/ingestion-inbox';

describe('request-id', () => {
  it('generates a UUID that does not derive from project/user/origin/time', () => {
    const value = defaultRequestIdProvider();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(value).not.toContain('project');
    expect(value).not.toContain('http');
  });
});

describe('cors adapter', () => {
  it('normalizes a plain https origin', () => {
    expect(validatePreflightOrigin('https://app.example.com')).toBe('https://app.example.com');
  });

  it('rejects null, empty, and path/query/userinfo origins', () => {
    expect(validatePreflightOrigin(undefined)).toBeNull();
    expect(validatePreflightOrigin('null')).toBeNull();
    expect(validatePreflightOrigin('https://app.example.com/some')).toBeNull();
    expect(validatePreflightOrigin('https://app.example.com?x=1')).toBeNull();
    expect(validatePreflightOrigin('https://user:pass@app.example.com')).toBeNull();
    expect(validatePreflightOrigin('ftp://app.example.com')).toBeNull();
    expect(validatePreflightOrigin('not a url')).toBeNull();
  });

  it('accepts only POST preflight with the allowed headers', () => {
    expect(
      isPreflightAllowed('POST', ['content-type', 'x-aurora-client-key', 'x-aurora-environment']),
    ).toBe(true);
    expect(isPreflightAllowed('GET', ['content-type'])).toBe(false);
    expect(isPreflightAllowed('POST', ['authorization'])).toBe(false);
  });
});

describe('receipt mapper', () => {
  it('maps inserted to accepted and duplicate to duplicate_accepted', () => {
    const results = mapPersistResultsToEventReceipts([
      { eventId: 'a', outcome: 'inserted' },
      { eventId: 'b', outcome: 'duplicate' },
    ]);
    expect(results.map((r) => r.state)).toEqual(['accepted', 'duplicate_accepted']);
    expect(results.every((r) => !r.retryable)).toBe(true);
  });
});

describe('error mapper', () => {
  it('maps database_unavailable to 503', () => {
    const mapped = mapErrorToHttp('req-1', new IngestionInboxError('database_unavailable', 'x'));
    expect(mapped.statusCode).toBe(503);
    expect(mapped.body.requestId).toBe('req-1');
  });

  it('maps statement_failed to 503 without leaking details', () => {
    const mapped = mapErrorToHttp('req-1', new IngestionInboxError('statement_failed', 'raw sql'));
    expect(mapped.statusCode).toBe(503);
    expect(JSON.stringify(mapped.body)).not.toContain('raw sql');
    expect(JSON.stringify(mapped.body)).not.toContain('SQLSTATE');
  });

  it('maps unknown errors to 500', () => {
    const mapped = mapErrorToHttp('req-1', new Error('kaboom'));
    expect(mapped.statusCode).toBe(500);
    expect(JSON.stringify(mapped.body)).not.toContain('kaboom');
  });

  it('rounds retryAfterMs up to whole seconds', () => {
    expect(retryAfterSeconds(2500)).toBe(3);
    expect(retryAfterSeconds(1000)).toBe(1);
    expect(retryAfterSeconds(1)).toBe(1);
  });
});
