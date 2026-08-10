import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIST_REQUEST_ENDPOINTS,
  requestsListEndpointsPathParams,
  requestsListEndpointsQuery,
  requestsListEndpointsResponse,
} from '../../src/monitoring/request-metrics.js';

describe('requestsListEndpoints contract', () => {
  it('pins the stable operation id', () => {
    expect(OPERATION_ID_LIST_REQUEST_ENDPOINTS).toBe('requestsListEndpoints');
  });
  it('requires organizationId and projectId path params', () => {
    // zod-compiled shape check: both keys present and non-optional.
    const schema = requestsListEndpointsPathParams.zod;
    expect(
      schema.safeParse({ organizationId: 'a'.repeat(36), projectId: 'b'.repeat(36) }).success,
    ).toBe(true);
    expect(schema.safeParse({ organizationId: 'a'.repeat(36) }).success).toBe(false);
  });
  it('pins query shape: required timeRange, optional cursor, defaulted limit', () => {
    const schema = requestsListEndpointsQuery.zod;
    const ok = schema.safeParse({
      timeRange: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' },
      limit: 50,
    });
    expect(ok.success).toBe(true);
    const missingRange = schema.safeParse({ limit: 50 });
    expect(missingRange.success).toBe(false);
  });
  it('pins the response as a queryResponse with summary/endpoints/percentiles sections', () => {
    // zod types must be structurally present (parses a valid projection)
    const schema = requestsListEndpointsResponse.zod;
    const valid = schema.safeParse({
      data: {
        summary: { status: 'empty', reason: 'no request data in window' },
        endpoints: { status: 'empty', reason: 'no samples in window' },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-020)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
        normalizedQuery: { timeRange: '2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z' },
      },
      allowedActions: ['read'],
      navigationTargets: [
        {
          routeId: 'project.requests',
          pathParams: { organizationId: 'o', projectId: 'p' },
          query: {},
        },
      ],
    });
    expect(valid.success).toBe(true);
  });
  it('accepts a base64url endpoint cursor that exceeds the old 64/512-char bounds (DAT-16)', () => {
    // The endpoint keyset cursor is base64url(method\nurl); a real URL encodes to
    // far more than 64 chars. This is the exact value the old str(1,64)/
    // str(1,512) bounds rejected (→ pagination 500). Both the query and the
    // response paginationMeta must accept it.
    const longUrl = 'https://api.example.test/checkout/' + 'x'.repeat(380);
    const cursor = Buffer.from(`GET\n${longUrl}`, 'utf8').toString('base64url');
    expect(cursor.length).toBeGreaterThan(64);

    const query = requestsListEndpointsQuery.zod.safeParse({
      timeRange: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' },
      cursor,
      limit: 50,
    });
    expect(query.success).toBe(true);

    const response = requestsListEndpointsResponse.zod.safeParse({
      data: {
        summary: { status: 'empty', reason: 'no request data in window' },
        endpoints: {
          status: 'available',
          data: {
            items: [
              {
                endpointId: 'e'.repeat(64),
                method: 'GET',
                url: longUrl,
                sampleCount: 1,
                outcomeCounts: [],
                dataThrough: '2026-08-02T00:00:00.000Z',
                isPartial: true,
                completeness: { source: 'diagnostic_samples', bounded: true },
              },
            ],
            pagination: {
              cursor,
              nextCursor: cursor,
              totalCount: 1,
              totalCountStatus: 'available',
            },
          },
        },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-020)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
        normalizedQuery: { timeRange: '2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z' },
      },
      allowedActions: ['read'],
      navigationTargets: [
        {
          routeId: 'project.requests',
          pathParams: { organizationId: 'o', projectId: 'p' },
          query: {},
        },
      ],
    });
    expect(response.success).toBe(true);
  });
});
