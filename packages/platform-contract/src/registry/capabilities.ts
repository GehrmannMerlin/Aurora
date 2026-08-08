// Contract capability enumeration for the generated manifest (spec §37.12: "契约能力均有表达" +
// coverage 清单逐项登记). Every capability here is a named contract capability that maps to
// concrete schema module exports that already exist in this package. Kept an honest, generated
// enumeration — no invented capabilities.

export interface ContractCapability {
  readonly capability: string;
  readonly schemaExports: readonly string[];
}

export const CONTRACT_CAPABILITIES: readonly ContractCapability[] = [
  {
    capability: 'RFC 9457 problem details',
    schemaExports: ['auroraProblem', 'PROBLEM_CATEGORY_CODES'],
  },
  {
    capability: 'Session/CSRF transport shape',
    schemaExports: ['identityGetSessionResponse'],
  },
  {
    capability: 'Pagination',
    schemaExports: ['pageResult', 'paginationMeta'],
  },
  {
    capability: 'Time (UTC timestamp + range)',
    schemaExports: ['utcTimestamp', 'timeRange'],
  },
  {
    capability: 'Sorting/filtering (normalized query)',
    schemaExports: ['normalizedQuery'],
  },
  {
    capability: 'Idempotency/concurrency',
    schemaExports: ['idempotencyKey', 'resourceVersion', 'commandResult'],
  },
  {
    capability: 'RouteTarget',
    schemaExports: ['ROUTE_TARGET_IDS', 'routeTarget'],
  },
  {
    capability: 'Capability projection',
    schemaExports: ['allowedActions', 'sectionResult'],
  },
  {
    capability: 'Unavailable/partial/stale sections',
    schemaExports: ['sectionResult', 'sectionStatus'],
  },
];
