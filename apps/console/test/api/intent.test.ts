import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIntentLink } from '../../src/api/intent.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('intent link client', () => {
  it('encodes the one-time token and projects only validated optional fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'valid',
          csrf: 'csrf_intent_test',
          maskedEmail: 'u***@example.invalid',
          organizationName: 'Example Org',
          role: 'member',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchIntentLink('email_verification', 'token/with spaces')).resolves.toEqual({
      status: 'valid',
      csrf: 'csrf_intent_test',
      maskedEmail: 'u***@example.invalid',
      organizationName: 'Example Org',
      role: 'member',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/verify/token%2Fwith%20spaces'),
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('omits invalid optional projections from a valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'valid', csrf: 'csrf_intent_test', role: 'viewer' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    await expect(fetchIntentLink('email_verification', 'opaque')).resolves.toEqual({
      status: 'valid',
      csrf: 'csrf_intent_test',
    });
  });

  it('rejects malformed success bodies without retaining the raw token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'valid', csrf: 123 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(fetchIntentLink('email_verification', 'opaque')).rejects.toMatchObject({
      code: 'structural_error',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 200 })));
    await expect(fetchIntentLink('email_verification', 'opaque')).rejects.toMatchObject({
      code: 'structural_error',
    });
  });

  it('preserves aborts and normalizes other transport failures', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(fetchIntentLink('email_verification', 'opaque')).rejects.toBe(abort);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchIntentLink('email_verification', 'opaque')).rejects.toMatchObject({
      code: 'network_error',
    });
  });
});
