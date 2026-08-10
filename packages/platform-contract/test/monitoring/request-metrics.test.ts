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
    expect(schema.safeParse({ organizationId: 'a'.repeat(36), projectId: 'b'.repeat(36) }).success).toBe(true);
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
      navigationTargets: [{ routeId: 'project.requests', pathParams: { organizationId: 'o', projectId: 'p' }, query: {} }],
    });
    expect(valid.success).toBe(true);
  });
});
