import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SdkBatchTransport } from '@aurora/sdk';
import { createBrowserBatchTransport } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

function batch() {
  return {
    protocolVersion: 1,
    events: [
      { protocolVersion: 1, eventId: 'e1', eventType: 'error', occurredAt: 1, body: { message: 'x' } },
    ],
  };
}
function receiptBody() {
  return {
    batchState: 'accepted',
    retryable: false,
    perEventResults: [{ eventId: 'e1', state: 'accepted', retryable: false }],
  };
}
function context() {
  return {
    mode: 'normal' as const,
    headers: {
      'Content-Type': 'application/json',
      'X-Aurora-Client-Key': 'aurora_ingest_k1_s',
      'X-Aurora-Environment': 'prod',
    },
  };
}

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('createBrowserBatchTransport', () => {
  it('POSTs to {endpoint}/v1/batches with chain-provided headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(receiptBody(), 200));
    const transport = createBrowserBatchTransport({
      ingestEndpoint: 'https://ingest.example.test/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await transport.send(batch() as Parameters<SdkBatchTransport['send']>[0], context());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ingest.example.test/v1/batches');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Aurora-Client-Key']).toBe('aurora_ingest_k1_s');
    expect(headers['X-Aurora-Environment']).toBe('prod');
    expect(result.kind).toBe('success');
  });

  it('maps HTTP 429 to a retryable http_error with Retry-After', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ batchState: 'temporarily_failed', retryable: true, errorCode: 'rate_limited', perEventResults: [] }, 429, { 'Retry-After': '2' }),
    );
    const transport = createBrowserBatchTransport({
      ingestEndpoint: 'https://ingest.example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await transport.send(batch() as Parameters<SdkBatchTransport['send']>[0], context());
    expect(result.kind).toBe('http_error');
    if (result.kind !== 'http_error') return;
    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBe(2000);
  });

  it('maps network failure to transport_failure and never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const transport = createBrowserBatchTransport({
      ingestEndpoint: 'https://ingest.example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await transport.send(batch() as Parameters<SdkBatchTransport['send']>[0], context());
    expect(result.kind).toBe('transport_failure');
  });

  it('uses fetch keepalive in best_effort mode', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(receiptBody(), 200));
    const transport = createBrowserBatchTransport({
      ingestEndpoint: 'https://ingest.example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await transport.send(batch() as Parameters<SdkBatchTransport['send']>[0], { ...context(), mode: 'best_effort' });
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1];
    expect(init?.keepalive).toBe(true);
  });

  it('returns non-retryable http_error when no ingest endpoint is configured', async () => {
    const transport = createBrowserBatchTransport({ ingestEndpoint: '' });
    const result = await transport.send(batch() as Parameters<SdkBatchTransport['send']>[0], context());
    expect(result.kind).toBe('http_error');
    if (result.kind !== 'http_error') return;
    expect(result.status).toBe(0);
  });
});
