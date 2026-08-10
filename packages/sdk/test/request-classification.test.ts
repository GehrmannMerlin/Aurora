import { describe, expect, it } from 'vitest';
import {
  classifyRequestEvent,
  createSafeDefaultSdkConfig,
  isRequestAllowed,
  normalizeRequestPath,
  parseOrigin,
  type SdkConfigSnapshot,
} from '../src/index.js';

const CONFIG: SdkConfigSnapshot = createSafeDefaultSdkConfig();

function requestDraft(body: unknown) {
  return { eventType: 'request' as const, body };
}

function requestBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    method: 'GET',
    url: 'https://shop.example.com/api/orders/10001',
    startedAt: 1,
    durationMs: 100,
    outcome: 'success',
    statusCode: 200,
    ...overrides,
  };
}

describe('parseOrigin', () => {
  it('parses scheme, host, port and strips default ports', () => {
    expect(parseOrigin('https://example.com/path')).toEqual({
      scheme: 'https',
      host: 'example.com',
      port: null,
      origin: 'https://example.com',
    });
    expect(parseOrigin('http://example.com:80/x')?.origin).toBe('http://example.com');
    expect(parseOrigin('https://example.com:8443/x')?.origin).toBe('https://example.com:8443');
    expect(parseOrigin('ftp://example.com/x')?.scheme).toBe('ftp');
  });
});

describe('isRequestAllowed', () => {
  it('allows same-origin by default and rejects cross-origin', () => {
    const context = { pageOrigin: 'https://shop.example.com' };
    expect(isRequestAllowed('https://shop.example.com/api/orders', CONFIG, context).allowed).toBe(true);
    expect(isRequestAllowed('https://api.example.com/orders', CONFIG, context).allowed).toBe(false);
  });

  it('rejects cross-origin when same-origin monitoring is disabled', () => {
    const config = { ...CONFIG, excludeSameOriginRequests: true };
    const context = { pageOrigin: 'https://shop.example.com' };
    expect(isRequestAllowed('https://shop.example.com/api/orders', config, context).allowed).toBe(false);
  });

  it('allows explicitly listed cross-origin origins and one-level wildcards', () => {
    const config = {
      ...CONFIG,
      allowedRequestOrigins: ['https://api.example.com', 'https://*.cdn.example.com'],
    };
    const context = { pageOrigin: 'https://shop.example.com' };
    expect(isRequestAllowed('https://api.example.com/orders', config, context).allowed).toBe(true);
    expect(isRequestAllowed('https://img.cdn.example.com/logo.png', config, context).allowed).toBe(true);
    expect(isRequestAllowed('https://deep.a.cdn.example.com/logo.png', config, context).allowed).toBe(false);
    expect(isRequestAllowed('https://cdn.example.com/logo.png', config, context).allowed).toBe(false);
  });

  it('rejects ignored URLs and SDK report URLs', () => {
    const config = { ...CONFIG, ignoredRequestUrls: ['/internal'] };
    const context = { pageOrigin: 'https://shop.example.com', sdkReportUrls: ['https://ingest.example.com'] };
    expect(isRequestAllowed('https://shop.example.com/internal/x', config, context).allowed).toBe(false);
    expect(isRequestAllowed('https://ingest.example.com/v1/batches', config, context).allowed).toBe(false);
  });

  it('rejects non-http schemes', () => {
    const context = { pageOrigin: 'https://shop.example.com' };
    expect(isRequestAllowed('data:text/plain,hello', CONFIG, context).allowed).toBe(false);
    expect(isRequestAllowed('blob:https://shop.example.com/abc', CONFIG, context).allowed).toBe(false);
  });
});

describe('normalizeRequestPath', () => {
  it('replaces high-confidence dynamic segments', () => {
    expect(normalizeRequestPath('https://shop.example.com/api/orders/10001', CONFIG)).toBe(
      'https://shop.example.com/api/orders/:number',
    );
    expect(
      normalizeRequestPath('https://shop.example.com/users/550e8400-e29b-41d4-a716-446655440000', CONFIG),
    ).toBe('https://shop.example.com/users/:uuid');
    expect(normalizeRequestPath('https://shop.example.com/assets/8f3a91c2d8e441a7', CONFIG)).toBe(
      'https://shop.example.com/assets/:hash',
    );
  });

  it('leaves ordinary words and short ids unchanged', () => {
    expect(normalizeRequestPath('https://shop.example.com/checkout/step-2', CONFIG)).toBe(
      'https://shop.example.com/checkout/step-2',
    );
    expect(normalizeRequestPath('https://shop.example.com/order/12', CONFIG)).toBe(
      'https://shop.example.com/order/:number',
    );
  });

  it('prioritizes developer path templates over auto-detection', () => {
    const config = {
      ...CONFIG,
      requestPathRules: [{ pattern: '/api/orders/:orderId', name: '订单详情' }],
    };
    expect(normalizeRequestPath('https://shop.example.com/api/orders/10001', config)).toBe(
      'https://shop.example.com/api/orders/:orderId',
    );
    expect(normalizeRequestPath('https://shop.example.com/api/users/10001', config)).toBe(
      'https://shop.example.com/api/users/:number',
    );
  });
});

describe('classifyRequestEvent', () => {
  const context = { pageOrigin: 'https://shop.example.com' };

  it('classifies success as normal', () => {
    const result = classifyRequestEvent(requestDraft(requestBody()), CONFIG, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.class).toBe('normal');
      expect(result.isError).toBe(false);
      expect(result.isSlow).toBe(false);
    }
  });

  it('classifies network failure, 429, and 5xx as error', () => {
    const network = classifyRequestEvent(requestDraft(requestBody({ outcome: 'network_error' })), CONFIG, context);
    expect(network.ok && network.class).toBe('error');
    const tooMany = classifyRequestEvent(requestDraft(requestBody({ statusCode: 429 })), CONFIG, context);
    expect(tooMany.ok && tooMany.class).toBe('error');
    const server = classifyRequestEvent(requestDraft(requestBody({ statusCode: 503 })), CONFIG, context);
    expect(server.ok && server.class).toBe('error');
  });

  it('classifies developer-configured extra status codes as error', () => {
    const config = { ...CONFIG, extraErrorStatusCodes: [418] };
    const result = classifyRequestEvent(requestDraft(requestBody({ statusCode: 418 })), config, context);
    expect(result.ok && result.class).toBe('error');
  });

  it('classifies slow requests at or above the threshold', () => {
    const slow = classifyRequestEvent(
      requestDraft(requestBody({ durationMs: 3000 })),
      CONFIG,
      context,
    );
    expect(slow.ok && slow.class).toBe('slow');
    const fast = classifyRequestEvent(requestDraft(requestBody({ durationMs: 2999 })), CONFIG, context);
    expect(fast.ok && fast.class).toBe('normal');
  });

  it('rejects a request outside the allowlist', () => {
    const result = classifyRequestEvent(
      requestDraft(requestBody({ url: 'https://analytics.example.net/collect' })),
      CONFIG,
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('disallowed_request');
      expect(result.reason).toBe('not_allowed_origin');
    }
  });

  it('does not mutate the input draft', () => {
    const input = requestDraft(requestBody());
    classifyRequestEvent(input, CONFIG, context);
    expect(input.body).toEqual(requestBody());
  });
});
