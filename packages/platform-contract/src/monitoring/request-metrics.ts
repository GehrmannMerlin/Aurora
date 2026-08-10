import { arr, bool, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { pageResult } from '../common/pagination.js';
import { timeRange, utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { sectionResult } from '../common/section.js';

export const OPERATION_ID_LIST_REQUEST_ENDPOINTS = 'requestsListEndpoints' as const;

export const requestsListEndpointsPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const requestsListEndpointsQuery = obj({
  timeRange,
  // Keyset cursor is base64url(method\nurl) (DAT-16): encoded length scales with
  // the URL, so a 64/512-char bound 500s on any real URL. 4096 comfortably fits
  // the largest encoded endpoint cursor.
  cursor: optional(str(1, 4096)),
  limit: optional(num(1, 100)),
});

const methodAggregate = obj({
  method: str(1, 16),
  observedCount: num(0),
  failureCount: num(0),
  slowCount: num(0),
  durationSumMs: num(0),
  durationMaxMs: num(0),
  outcomes: arr(obj({ outcome: str(1, 32), count: num(0) }), 0, 16),
});

const requestAggregateSummary = obj({
  methods: arr(methodAggregate, 0, 100),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
});

const requestEndpointSummary = obj({
  endpointId: str(1, 64),
  method: str(1, 16),
  url: str(1, 2048),
  sampleCount: num(0),
  outcomeCounts: arr(obj({ outcome: str(1, 32), count: num(0) }), 0, 16),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
  completeness: obj({ source: str(1, 32), bounded: bool() }),
});

export const requestsListEndpointsResponse = queryResponse(
  obj({
    summary: sectionResult(requestAggregateSummary),
    endpoints: sectionResult(pageResult(requestEndpointSummary)),
    percentiles: sectionResult(obj({})),
  }),
);
