import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_GET_DATA_STATUS,
  diagnosticsGetDataStatusPathParams,
  diagnosticsGetDataStatusQuery,
  diagnosticsGetDataStatusResponse,
} from '../../src/monitoring/diagnostics.js';

describe('diagnosticsGetDataStatus contract', () => {
  it('pins the stable operation id', () => {
    expect(OPERATION_ID_GET_DATA_STATUS).toBe('diagnosticsGetDataStatus');
  });

  it('requires organizationId and projectId path params', () => {
    const schema = diagnosticsGetDataStatusPathParams.zod;
    expect(
      schema.safeParse({ organizationId: 'a'.repeat(36), projectId: 'b'.repeat(36) }).success,
    ).toBe(true);
    expect(schema.safeParse({ organizationId: 'a'.repeat(36) }).success).toBe(false);
    expect(schema.safeParse({ projectId: 'b'.repeat(36) }).success).toBe(false);
  });

  it('pins the query shape with an optional timeRange', () => {
    const schema = diagnosticsGetDataStatusQuery.zod;
    // timeRange is optional: the server applies the default last-24h window.
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({
        timeRange: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('pins the response as a queryResponse with the six diagnosis sections + actionTargets', () => {
    const schema = diagnosticsGetDataStatusResponse.zod;
    const valid = schema.safeParse({
      data: {
        summary: {
          status: 'available',
          data: {
            status: 'receiving',
            primaryCause: 'processing_backlog',
            asOf: '2026-08-02T00:00:00.000Z',
          },
        },
        stages: {
          status: 'available',
          data: {
            received: { count: 3, latestAt: '2026-08-02T00:00:00.000Z' },
            processing: { count: 1 },
            processed: { count: 2, latestAt: '2026-08-02T00:00:00.000Z' },
            deadLetter: { count: 0, lastErrorCode: 'processing_failed' },
          },
        },
        recent: {
          status: 'available',
          data: {
            latestReceivedAt: '2026-08-02T00:00:00.000Z',
            receivedCount: 3,
            latestProcessedAt: '2026-08-02T00:00:00.000Z',
            processedCount: 2,
            environmentBreakdown: {
              status: 'unavailable',
              reason: 'environment not persisted (deferred)',
            },
          },
        },
        rejection: {
          status: 'unavailable',
          reason: 'rejected batches are not persisted (deferred)',
        },
        credential: {
          status: 'available',
          data: {
            activeCount: 1,
            disabledCount: 0,
            revokedCount: 0,
            latestCreatedAt: '2026-08-01T00:00:00.000Z',
          },
        },
        queryable: {
          status: 'available',
          data: {
            errorOccurrences: 2,
            requestMetricBuckets: 4,
            performanceMetricBuckets: 0,
            latestProcessedAt: '2026-08-02T00:00:00.000Z',
          },
        },
        actionTargets: [
          {
            routeId: 'project.requests',
            pathParams: { organizationId: 'o', projectId: 'p' },
            query: {},
          },
        ],
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
        normalizedQuery: {
          timeRange: '2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z',
        },
      },
      allowedActions: ['read'],
      navigationTargets: [
        {
          routeId: 'project.data-status',
          pathParams: { organizationId: 'o', projectId: 'p' },
          query: {},
        },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it('pins the summary status and primaryCause enum values', () => {
    const schema = diagnosticsGetDataStatusResponse.zod;
    // Every DiagnosisSummary.status value parses; the five-value enum is closed.
    for (const status of ['receiving', 'processing', 'blocked', 'not_receiving', 'unknown']) {
      const res = schema.safeParse({
        data: {
          summary: { status: 'available', data: { status, asOf: '2026-08-02T00:00:00.000Z' } },
          stages: { status: 'empty', reason: 'no data' },
          recent: { status: 'empty', reason: 'no data' },
          rejection: { status: 'unavailable', reason: 'rejected batches are not persisted' },
          credential: { status: 'empty', reason: 'no credential' },
          queryable: { status: 'empty', reason: 'no queryable evidence' },
          actionTargets: [],
        },
        meta: {
          requestId: 'req_' + '1'.repeat(20),
          readAt: '2026-08-02T00:00:00.000Z',
        },
        allowedActions: ['read'],
        navigationTargets: [],
      });
      expect(res.success, status).toBe(true);
    }
    // A status outside the closed enum is rejected.
    const bad = schema.safeParse({
      data: {
        summary: { status: 'available', data: { status: 'bogus', asOf: '2026-08-02T00:00:00.000Z' } },
        stages: { status: 'empty', reason: 'no data' },
        recent: { status: 'empty', reason: 'no data' },
        rejection: { status: 'unavailable', reason: 'rejected batches are not persisted' },
        credential: { status: 'empty', reason: 'no credential' },
        queryable: { status: 'empty', reason: 'no queryable evidence' },
        actionTargets: [],
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
      },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(bad.success).toBe(false);
  });
});
