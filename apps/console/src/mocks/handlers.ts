import { http, HttpResponse, type JsonBodyType } from 'msw';
import {
  validAcceptInvitationSamples,
  validChangePasswordSamples,
  validConfirmEmailVerificationSamples,
  validConfirmPasswordResetSamples,
  validCreatePrivateTokenSamples,
  validInviteMemberSamples,
  validListMembersSamples,
  validListPrivateTokensSamples,
  validListProjectsSamples,
  validListSecurityAuditSamples,
  validListTrashSamples,
  validLoginSamples,
  validLogoutSamples,
  validNavigationSamples,
  validRegisterSamples,
  validRequestPasswordResetSamples,
  validRestoreProjectSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export interface MockScope {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
}

const MOCK_SCOPE_STORAGE_KEY = '__aurora_mock_scope';
const MOCK_SESSION_STORAGE_KEY = '__aurora_mock_session_authenticated';
const MOCK_DELETION_PREFLIGHT_STORAGE_KEY = '__aurora_mock_deletion_preflight';

function readStoredScope(): MockScope {
  try {
    const raw = sessionStorage.getItem(MOCK_SCOPE_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { type?: string; id?: string } | string | null;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        (parsed.type === 'workspace' || parsed.type === 'organization' || parsed.type === 'project')
      ) {
        return parsed.id === undefined
          ? { type: parsed.type }
          : { type: parsed.type, id: parsed.id };
      }
    }
  } catch {
    // storage may be unavailable (non-browser harness); fall through to the default
  }
  return { type: 'project', id: 'prj_test_1' };
}

function readStoredSessionAuthenticated(): boolean {
  try {
    const raw = sessionStorage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (raw !== null) return raw === 'true';
  } catch {
    // storage may be unavailable; default to an authenticated session
  }
  return true;
}

function readStoredDeletionPreflight(): 'ready' | 'blocked' {
  try {
    const raw = sessionStorage.getItem(MOCK_DELETION_PREFLIGHT_STORAGE_KEY);
    if (raw === 'blocked') return 'blocked';
    if (raw === 'ready') return 'ready';
  } catch {
    // storage may be unavailable; default to the ready projection
  }
  return 'ready';
}

let mockScope: MockScope = readStoredScope();

const navigationBody = JSON.parse(JSON.stringify(validNavigationSamples[0])) as {
  currentScope: unknown;
};

// Monitoring workspace mock projections (PLT-05/PLT-06). These mirror the
// approved public Query contract shapes and are used ONLY by the test-mode MSW
// harness (unit + browser reachability). They are never production data and are
// never used as completion evidence for the G11 browser acceptance, which runs
// against a real Platform API.
const MONITORING_READ_AT = '2026-08-10T09:00:00.000Z';

function mockDataStatus(organizationId: string, projectId: string) {
  return {
    data: {
      summary: {
        status: 'available',
        data: { status: 'receiving', asOf: MONITORING_READ_AT },
      },
      stages: {
        status: 'available',
        data: {
          received: { count: 5, latestAt: '2026-08-10T08:59:00.000Z' },
          processing: { count: 2, latestAt: '2026-08-10T08:58:00.000Z' },
          processed: { count: 3, latestAt: '2026-08-10T08:57:00.000Z' },
          deadLetter: { count: 0 },
        },
      },
      recent: {
        status: 'available',
        data: {
          latestReceivedAt: '2026-08-10T08:59:00.000Z',
          receivedCount: 5,
          latestProcessedAt: '2026-08-10T08:57:00.000Z',
          processedCount: 3,
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
          latestCreatedAt: '2026-08-10T07:00:00.000Z',
        },
      },
      queryable: {
        status: 'available',
        data: {
          errorOccurrences: 3,
          requestMetricBuckets: 0,
          performanceMetricBuckets: 0,
          latestProcessedAt: '2026-08-10T08:57:00.000Z',
        },
      },
      actionTargets: [
        {
          routeId: 'project.requests',
          pathParams: { organizationId, projectId },
          query: {},
        },
        {
          routeId: 'project.performance',
          pathParams: { organizationId, projectId },
          query: {},
        },
      ],
    },
    meta: { requestId: 'req_test_data_status', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockIssueList(nextCursor?: string) {
  return {
    data: {
      issues: {
        status: 'available',
        items: [
          {
            issueId: 'issue_test_1',
            title: 'TypeError: Cannot read properties of undefined (reading "x")',
            status: 'open',
            occurrenceCount: 12,
            sampleCount: 3,
            firstSeenAt: '2026-08-09T10:00:00.000Z',
            lastSeenAt: '2026-08-10T08:00:00.000Z',
            priority: 'high',
            version: 1,
          },
          {
            issueId: 'issue_test_2',
            title: 'ReferenceError: foo is not defined',
            status: 'open',
            occurrenceCount: 4,
            sampleCount: 1,
            firstSeenAt: '2026-08-10T01:00:00.000Z',
            lastSeenAt: '2026-08-10T07:00:00.000Z',
            version: 1,
          },
        ],
        pagination: {
          totalCount: 2,
          totalCountStatus: 'available',
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
      },
      filters: { status: 'available' },
      summary: { status: 'available' },
      environments: {
        status: 'unavailable',
        reason: 'environment dimension deferred (contract gap)',
      },
      releases: { status: 'unavailable', reason: 'release dimension deferred (contract gap)' },
    },
    meta: { requestId: 'req_test_issues', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockIssueDetail(issueId: string) {
  return {
    data: {
      issue: {
        status: 'available',
        data: {
          issueId,
          title: 'TypeError: Cannot read properties of undefined (reading "x")',
          category: 'runtime',
          fingerprintVersion: 1,
          occurrenceCount: 12,
          sampleCount: 3,
          firstSeenAt: '2026-08-09T10:00:00.000Z',
          lastSeenAt: '2026-08-10T08:00:00.000Z',
          status: 'open',
          priority: 'high',
          version: 1,
        },
      },
      samples: {
        status: 'available',
        items: [
          {
            sampleId: 'sample_test_1',
            occurredAt: '2026-08-10T08:00:00.000Z',
            sampleKind: 'error',
            sampleBody: { message: 'Cannot read properties of undefined', category: 'runtime' },
          },
        ],
      },
      activity: {
        status: 'available',
        activities: [
          {
            activityType: 'issue_created',
            createdAt: '2026-08-09T10:00:00.000Z',
            details: {},
          },
        ],
        notes: [],
      },
    },
    meta: { requestId: 'req_test_issue_detail', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockRequestEndpoints() {
  return {
    data: {
      summary: {
        status: 'available',
        data: {
          methods: [
            {
              method: 'GET',
              observedCount: 120,
              failureCount: 3,
              slowCount: 1,
              durationSumMs: 120000,
              durationMaxMs: 4000,
              outcomes: [
                { outcome: 'success', count: 117 },
                { outcome: 'error', count: 3 },
              ],
            },
          ],
          dataThrough: '2026-08-10T08:59:00.000Z',
          isPartial: false,
        },
      },
      endpoints: {
        status: 'available',
        data: {
          items: [
            {
              endpointId: 'ep_test_1',
              method: 'GET',
              url: '/api/items',
              sampleCount: 120,
              outcomeCounts: [
                { outcome: 'success', count: 117 },
                { outcome: 'error', count: 3 },
              ],
              dataThrough: '2026-08-10T08:59:00.000Z',
              isPartial: false,
              completeness: { source: 'samples', bounded: true },
            },
          ],
          pagination: { totalCount: 1, totalCountStatus: 'available' },
        },
      },
      percentiles: { status: 'unavailable', reason: 'percentile raw material deferred (ADR-021)' },
    },
    meta: { requestId: 'req_test_requests', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockPerformancePages() {
  return {
    data: {
      metrics: {
        status: 'available',
        data: {
          metrics: [
            {
              metricName: 'lcp',
              unit: 'millisecond',
              observedCount: 40,
              valueSum: 100000,
              valueMax: 5000,
              mean: 2500,
            },
            {
              metricName: 'inp',
              unit: 'millisecond',
              observedCount: 40,
              valueSum: 4000,
              valueMax: 400,
              mean: 100,
            },
            {
              metricName: 'cls',
              unit: 'ratio',
              observedCount: 40,
              valueSum: 40,
              valueMax: 2,
              mean: 1,
            },
            {
              metricName: 'page_load',
              unit: 'millisecond',
              observedCount: 40,
              valueSum: 120000,
              valueMax: 6000,
              mean: 3000,
            },
          ],
          dataThrough: '2026-08-10T08:59:00.000Z',
          isPartial: false,
        },
      },
      pages: { status: 'unavailable', reason: 'page dimension not present in data (DAT-17)' },
      percentiles: { status: 'unavailable', reason: 'percentile raw material deferred (ADR-021)' },
    },
    meta: { requestId: 'req_test_performance', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

// PLT-07 (C8—C12) mock projections — DAT-18 releases/source-maps and DAT-19
// alerts. Test-mode MSW only (unit + browser smoke); never production data and
// never completion evidence for the real Platform API.

function mockReleases() {
  return {
    data: {
      status: 'available',
      data: {
        items: [
          {
            releaseId: 'release_test_1',
            version: 'shop-web@1.4.3',
            source: 'source_map_upload',
            firstSeenAt: '2026-08-10T08:00:00.000Z',
            sourceMapFileCount: 1,
          },
          {
            releaseId: 'release_test_2',
            version: 'shop-web@1.4.2',
            source: 'source_map_upload',
            firstSeenAt: '2026-08-09T08:00:00.000Z',
            sourceMapFileCount: 0,
          },
        ],
      },
    },
    meta: { requestId: 'req_test_releases', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockSourceMapFiles() {
  return {
    data: {
      status: 'available',
      data: {
        items: [
          {
            sourceMapFileId: 'sm_test_1',
            buildPath: '/assets/app.js',
            digestPrefix: 'a1b2c3d4',
            status: 'active',
            reparse: {
              state: 'completed',
              processedCount: 2,
              totalCount: 2,
              updatedAt: '2026-08-10T08:10:00.000Z',
            },
            uploadedAt: '2026-08-10T08:00:00.000Z',
            version: 1,
          },
        ],
      },
    },
    meta: { requestId: 'req_test_source_maps', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockAlerts() {
  return {
    data: {
      rules: {
        status: 'available',
        data: {
          items: [
            {
              ruleId: 'rule_test_1',
              name: '错误数量过高',
              metric: 'error_count',
              windowMinutes: 5,
              triggerThreshold: 100,
              recoveryThreshold: 60,
              recipientAccountIds: ['account_test_1'],
              evaluation: {
                state: 'normal',
                observedValue: 12,
                sinceAt: '2026-08-10T08:00:00.000Z',
                lastEvaluatedAt: '2026-08-10T08:59:00.000Z',
              },
              version: 1,
            },
          ],
        },
      },
      instances: {
        status: 'available',
        data: {
          items: [
            {
              instanceId: 'instance_test_1',
              ruleId: 'rule_test_1',
              ruleName: '错误数量过高',
              metric: 'error_count',
              state: 'triggered',
              triggeredAt: '2026-08-10T08:30:00.000Z',
            },
          ],
          count: 1,
          totalCountStatus: 'bounded',
        },
      },
    },
    meta: { requestId: 'req_test_alerts', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockAlertCapability() {
  return {
    data: {
      metrics: [
        {
          metric: 'error_count',
          displayName: 'Error count',
          unit: 'count',
          direction: 'higher_is_worse',
          isRatio: false,
          minSamplesRequired: false,
          filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
        },
        {
          metric: 'new_issue_count',
          displayName: 'New issue count',
          unit: 'count',
          direction: 'higher_is_worse',
          isRatio: false,
          minSamplesRequired: false,
          filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
        },
        {
          metric: 'issue_reappearance_count',
          displayName: 'Issue reappearance count',
          unit: 'count',
          direction: 'higher_is_worse',
          isRatio: false,
          minSamplesRequired: false,
          filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
        },
        {
          metric: 'request_failure_rate',
          displayName: 'Request failure rate',
          unit: 'percentage',
          direction: 'higher_is_worse',
          isRatio: true,
          minSamplesRequired: true,
          filterDimensions: ['environment', 'release', 'page_or_endpoint'],
        },
        {
          metric: 'slow_request_count',
          displayName: 'Slow request count',
          unit: 'count',
          direction: 'higher_is_worse',
          isRatio: false,
          minSamplesRequired: false,
          filterDimensions: ['environment', 'release', 'page_or_endpoint'],
        },
        {
          metric: 'lcp_ratio',
          displayName: 'LCP exceeded ratio',
          unit: 'percentage',
          direction: 'higher_is_worse',
          isRatio: true,
          minSamplesRequired: true,
          filterDimensions: ['environment', 'release', 'page_or_endpoint'],
        },
        {
          metric: 'inp_ratio',
          displayName: 'INP exceeded ratio',
          unit: 'percentage',
          direction: 'higher_is_worse',
          isRatio: true,
          minSamplesRequired: true,
          filterDimensions: ['environment', 'release', 'page_or_endpoint'],
        },
        {
          metric: 'cls_ratio',
          displayName: 'CLS exceeded ratio',
          unit: 'percentage',
          direction: 'higher_is_worse',
          isRatio: true,
          minSamplesRequired: true,
          filterDimensions: ['environment', 'release', 'page_or_endpoint'],
        },
      ],
      windowsMinutes: [1, 5, 10, 30, 60],
      triggerDurationsMinutes: [0, 1, 2, 5, 10],
      cooldownsMinutes: [5, 10, 30, 60],
      filterDimensions: [
        { id: 'environment', available: false, reason: 'no event-side data source yet' },
        { id: 'release', available: false, reason: 'no event-side data source yet' },
        { id: 'page_or_endpoint', available: false, reason: 'no event-side data source yet' },
        { id: 'error_severity', available: false, reason: 'no event-side data source yet' },
      ],
      recipients: [{ accountId: 'account_test_1', maskedEmail: 'a***@example.com' }],
    },
    meta: {
      requestId: 'req_test_alert_capability',
      readAt: MONITORING_READ_AT,
      normalizedQuery: {},
    },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockAlertInstanceDetail(instanceId: string) {
  return {
    data: {
      instance: {
        instanceId,
        ruleId: 'rule_test_1',
        ruleName: '错误数量过高',
        metric: 'error_count',
        state: 'triggered',
        directReason: 'triggered',
        triggeredAt: '2026-08-10T08:30:00.000Z',
      },
      ruleSnapshot: {
        name: '错误数量过高',
        metric: 'error_count',
        filters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
        windowMinutes: 5,
        triggerThreshold: 100,
        triggerDurationMinutes: 2,
        recoveryThreshold: 60,
        recoveryDurationMinutes: 2,
        cooldownMinutes: 10,
      },
      evidence: {
        evaluatedAt: '2026-08-10T08:30:00.000Z',
        windowStartAt: '2026-08-10T08:25:00.000Z',
        windowEndAt: '2026-08-10T08:30:00.000Z',
        observedValue: 120,
        numerator: 120,
        denominator: 1,
        sampleCount: 120,
        watermarkAt: '2026-08-10T08:30:00.000Z',
        completeness: 'complete',
        appliedFilters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
      },
      transitions: [
        {
          from: 'pending_trigger',
          to: 'triggered',
          reason: 'triggered',
          occurredAt: '2026-08-10T08:30:00.000Z',
        },
      ],
    },
    meta: { requestId: 'req_test_alert_instance', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

// PLT-08 (C13—C16) mock projections — access / client-keys / settings / lifecycle.
// Test-mode MSW only (unit + browser smoke); never production data.

function mockEffectiveMembers() {
  return {
    data: {
      status: 'available',
      data: {
        items: [
          {
            accountId: 'account_test_1',
            maskedEmail: 'o***@example.com',
            effectiveRole: 'project_admin',
            sources: ['org_inherited'],
            allowedActions: ['read'],
          },
          {
            accountId: 'account_test_2',
            maskedEmail: 'd***@example.com',
            effectiveRole: 'developer',
            sources: ['project_member'],
            projectRole: 'developer',
            allowedActions: ['read', 'manage'],
          },
        ],
      },
    },
    meta: { requestId: 'req_test_members', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

function mockClientKeys() {
  return {
    data: {
      status: 'available',
      data: {
        items: [
          {
            credentialId: 'cred_test_1',
            keyId: 'ck_abcdefgh',
            status: 'active',
            allowNonBrowser: false,
            origins: ['https://app.example.invalid'],
            environments: ['production'],
            createdAt: '2026-08-12T00:00:00.000Z',
            updatedAt: '2026-08-12T00:00:00.000Z',
          },
        ],
      },
    },
    meta: { requestId: 'req_test_client_keys', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

/** PLT-09 D1 mock notifications list + unread count (account-scoped, test fixture only). */
function mockNotifications() {
  return {
    data: {
      notifications: {
        status: 'available',
        items: [
          {
            notificationId: 'notif_test_1',
            type: 'new_issue',
            title: '新问题出现',
            summary: 'TypeError: boom',
            organizationId: 'org_test_1',
            projectId: 'prj_test_1',
            occurredAt: '2026-08-12T08:00:00.000Z',
            readAt: '2026-08-12T08:05:00.000Z',
            target: {
              routeId: 'project.issue-detail',
              pathParams: {
                organizationId: 'org_test_1',
                projectId: 'prj_test_1',
                issueId: '7',
              },
              query: {},
            },
          },
          {
            notificationId: 'notif_test_2',
            type: 'alert_triggered',
            title: '错误数量过高 已触发',
            organizationId: 'org_test_1',
            projectId: 'prj_test_1',
            occurredAt: '2026-08-12T09:00:00.000Z',
            target: {
              routeId: 'project.alert-instance-detail',
              pathParams: {
                organizationId: 'org_test_1',
                projectId: 'prj_test_1',
                instanceId: '3',
              },
              query: {},
            },
          },
        ],
        pagination: { totalCount: 2, totalCountStatus: 'available' },
      },
      unreadCount: { value: 1, status: 'available' },
    },
    meta: { requestId: 'req_test_notifications', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

// PLT-10c (D2) platform resource-policy mock projections — capability probe,
// target search, and the three effective-policy GETs. Test-mode MSW only (unit
// + browser smoke); never production data and never completion evidence for the
// real Platform API (D2 runs against platform-api + @aurora/platform-admin in
// the real stack).

const POLICY_READ_AT = '2026-08-12T00:00:00.000Z';

/** PRD §15.8 five protective fields (platform default / organization override). */
const MOCK_POLICY_FIELDS = {
  defaultPeriodQuota: 100000,
  warningRatio: 80,
  hardLimit: 100,
  degradationEnabled: true,
  highValueRetentionDays: 90,
} as const;

const MOCK_POLICY_TARGETS = {
  organizations: [
    { organizationId: 'org_test_1', name: 'Acme' },
    { organizationId: 'org_test_2', name: 'Globex' },
  ],
  projects: [
    { projectId: 'prj_test_1', organizationId: 'org_test_1', name: 'Web shop' },
    { projectId: 'prj_test_2', organizationId: 'org_test_1', name: 'Mobile app' },
    { projectId: 'prj_test_3', organizationId: 'org_test_2', name: 'Inventory' },
  ],
} as const;

/** Test-mode default is a platform admin so the D2 page is reachable in tests. */
function mockPlatformAdminCapability() {
  return { data: { hasCapability: true } };
}

/** Target search filtered by `q` (case-insensitive name prefix; ILIKE-ish). */
function mockPolicyTargetSearch(q: string | null) {
  const needle = (q ?? '').trim().toLowerCase();
  const matches = (name: string) => needle === '' || name.toLowerCase().startsWith(needle);
  return {
    data: {
      organizations: MOCK_POLICY_TARGETS.organizations.filter((org) => matches(org.name)),
      projects: MOCK_POLICY_TARGETS.projects.filter((prj) => matches(prj.name)),
      pagination: { totalCountStatus: 'available' },
    },
    meta: { requestId: 'req_test_policy_targets', readAt: POLICY_READ_AT, normalizedQuery: {} },
    allowedActions: ['read', 'manage'],
    navigationTargets: [],
  };
}

/** Platform default / organization effective projection (five-field shape). */
function mockPolicyDefaultProjection() {
  return {
    data: {
      data: {
        configured: { ...MOCK_POLICY_FIELDS },
        source: 'platform_admin',
        effective: { ...MOCK_POLICY_FIELDS },
        version: 1,
        updatedAt: '2026-08-12T00:00:00.000Z',
        updatedBy: 'account_test_1',
        propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
      },
    },
    meta: { requestId: 'req_test_policy_default', readAt: POLICY_READ_AT, normalizedQuery: {} },
    allowedActions: ['read', 'manage'],
    navigationTargets: [],
  };
}

/** Organization effective projection with its own override row (five-field shape). */
function mockPolicyOrganizationProjection() {
  return {
    data: {
      data: {
        configured: { ...MOCK_POLICY_FIELDS },
        source: 'platform_admin',
        effective: { ...MOCK_POLICY_FIELDS },
        version: 2,
        updatedAt: '2026-08-12T00:00:00.000Z',
        updatedBy: 'account_test_1',
        propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
      },
    },
    meta: { requestId: 'req_test_policy_org', readAt: POLICY_READ_AT, normalizedQuery: {} },
    allowedActions: ['read', 'manage'],
    navigationTargets: [],
  };
}

/** Project effective projection: own resourceLimit override + inherited five fields. */
function mockPolicyProjectProjection() {
  return {
    data: {
      data: {
        configured: { resourceLimit: 5000 },
        source: 'inherited_from_organization',
        effective: { ...MOCK_POLICY_FIELDS, resourceLimit: 5000 },
        version: 1,
        updatedAt: '2026-08-12T00:00:00.000Z',
        updatedBy: 'account_test_1',
        propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
      },
    },
    meta: { requestId: 'req_test_policy_project', readAt: POLICY_READ_AT, normalizedQuery: {} },
    allowedActions: ['read', 'manage'],
    navigationTargets: [],
  };
}

function mockProjectSettings() {
  return {
    data: {
      project: {
        projectId: 'prj_test_1',
        name: 'Web shop',
        frameworkType: 'vue',
        websiteUrl: 'https://example.invalid',
        lifecycle: { status: 'active' },
        resourceVersion: '2026-08-12T00:00:00.000Z',
      },
    },
    meta: { requestId: 'req_test_settings', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read', 'update'],
    navigationTargets: [],
  };
}

function mockProjectEnvironments() {
  return {
    data: {
      status: 'available',
      data: {
        items: [
          {
            environmentId: 'env_test_1',
            name: 'production',
            isDefault: 'true',
            createdAt: '2026-08-12T00:00:00.000Z',
          },
        ],
      },
    },
    meta: { requestId: 'req_test_environments', readAt: MONITORING_READ_AT, normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

export const handlerControls = {
  delayMs: 0,
  sessionRequests: 0,
  registerRequests: 0,
  loginRequests: 0,
  logoutRequests: 0,
  confirmEmailRequests: 0,
  requestPasswordResetRequests: 0,
  confirmPasswordResetRequests: 0,
  changePasswordRequests: 0,
  acceptInvitationRequests: 0,
  intentLinkRequests: 0,
  listProjectsRequests: 0,
  createProjectRequests: 0,
  listMembersRequests: 0,
  inviteMemberRequests: 0,
  revokeInvitationRequests: 0,
  resendInvitationRequests: 0,
  changeRoleRequests: 0,
  removeMemberRequests: 0,
  transferOwnershipRequests: 0,
  updateTimezoneRequests: 0,
  listPrivateTokensRequests: 0,
  createPrivateTokenRequests: 0,
  revokePrivateTokenRequests: 0,
  listSecurityAuditRequests: 0,
  listTrashRequests: 0,
  restoreProjectRequests: 0,
  deletionPreflightRequests: 0,
  requestAccountDeletionRequests: 0,
  deleteAccountRequests: 0,
  cancelDeletionRequests: 0,
  dataStatusRequests: 0,
  listIssuesRequests: 0,
  getIssueDetailRequests: 0,
  listRequestEndpointsRequests: 0,
  listPerformancePagesRequests: 0,
  listReleasesRequests: 0,
  listSourceMapFilesRequests: 0,
  uploadSourceMapRequests: 0,
  replaceSourceMapRequests: 0,
  reparseSourceMapRequests: 0,
  listAlertsRequests: 0,
  getAlertCapabilityRequests: 0,
  getAlertInstanceDetailRequests: 0,
  createAlertRuleRequests: 0,
  updateAlertRuleRequests: 0,
  listEffectiveMembersRequests: 0,
  grantMembershipRequests: 0,
  projectChangeRoleRequests: 0,
  removeMembershipRequests: 0,
  listClientKeysRequests: 0,
  createClientKeyRequests: 0,
  disableClientKeyRequests: 0,
  enableClientKeyRequests: 0,
  revokeClientKeyRequests: 0,
  getProjectSettingsRequests: 0,
  updateProjectSettingsRequests: 0,
  listEnvironmentsRequests: 0,
  createEnvironmentRequests: 0,
  archiveLifecycleRequests: 0,
  restoreLifecycleRequests: 0,
  moveToTrashRequests: 0,
  /** Toggle for the session projection: true = authenticated, false = 401. */
  sessionAuthenticated: readStoredSessionAuthenticated(),
  /** Toggle for the A5 deletion preflight projection: ready = no blocker. */
  deletionPreflightStatus: readStoredDeletionPreflight(),
};

const unauthenticatedProblem = {
  type: 'about:blank',
  title: 'Authentication required',
  status: 401,
  detail: 'No active session.',
  code: 'authentication',
  requestId: 'req_test_unauth',
};

function persistSessionAuthenticated(value: boolean): void {
  handlerControls.sessionAuthenticated = value;
  try {
    sessionStorage.setItem(MOCK_SESSION_STORAGE_KEY, String(value));
  } catch {
    // storage unavailable; the module flag still applies for this page lifetime
  }
}

function persistDeletionPreflight(status: 'ready' | 'blocked'): void {
  handlerControls.deletionPreflightStatus = status;
  try {
    sessionStorage.setItem(MOCK_DELETION_PREFLIGHT_STORAGE_KEY, status);
  } catch {
    // storage unavailable; the module flag still applies for this page lifetime
  }
}

export function setMockScope(scope: MockScope): void {
  mockScope = scope;
  try {
    sessionStorage.setItem(MOCK_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // storage may be unavailable in some harnesses; the module state still applies
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeDelay(): Promise<void> {
  return handlerControls.delayMs > 0 ? delay(handlerControls.delayMs) : Promise.resolve();
}

const INTENT_LINK_RESPONSES = {
  email_verification: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
  },
  password_reset: { status: 'valid', csrf: 'csrf_intent_token' },
  organization_invitation: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    organizationName: 'Acme',
    role: 'member',
  },
  deletion_cancel: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    intentKind: 'deletion_cancel',
  },
  deletion_request: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    intentKind: 'deletion_request',
  },
} as const;

// A5 deletion preflight projections (contract §5.2): ready = no unique-owner
// blocker; blocked = the blocking orgs the account still owns outright.
const DELETION_PREFLIGHT_REQUIRED_LIFECYCLE = {
  coolingHours: 168,
  onlineCleanupDays: 7,
  auditRetentionYears: 1,
  backupRetentionDays: 35,
} as const;

const DELETION_PREFLIGHT_READY = {
  status: 'ready',
  requiredLifecycle: DELETION_PREFLIGHT_REQUIRED_LIFECYCLE,
  serverTime: '2026-08-09T01:00:00.000Z',
} as const;

const DELETION_PREFLIGHT_BLOCKED = {
  status: 'blocked',
  blockingOrganizations: [
    { organizationId: 'org_test_1', organizationName: 'Acme', organizationKind: 'organization' },
  ],
  requiredLifecycle: DELETION_PREFLIGHT_REQUIRED_LIFECYCLE,
  serverTime: '2026-08-09T01:00:00.000Z',
} as const;

// A5 request-email success: the confirmation email is sent to the masked
// recipient (mirrors the real contract shape; no full email, no token).
const REQUEST_ACCOUNT_DELETION_SUCCESS = {
  status: 'succeeded',
  maskedEmail: 'us**@example.invalid',
  resendAvailableAt: '2026-08-09T01:01:00.000Z',
} as const;

// A5 delete-command success: account enters the server-authoritative cooling
// window and every session is revoked (mirrors the real contract shape).
const DELETE_ACCOUNT_SUCCESS = {
  status: 'succeeded',
  accountStatus: 'deletion_cooling',
  deletionRequestedAt: '2026-08-09T01:00:00.000Z',
  deletionCoolingEndsAt: '2026-08-16T01:00:00.000Z',
  sessionImpact: 'revoked_all',
} as const;

// A5 cancel-command success: the account returns to active and every session is
// revoked (the user must re-login; mirrors the real contract shape).
const CANCEL_DELETION_SUCCESS = {
  status: 'succeeded',
  accountStatus: 'active',
  sessionImpact: 'revoked_all',
} as const;

export function createPlatformHandlers() {
  return [
    http.get('/api/platform/v1/session', async () => {
      handlerControls.sessionRequests += 1;
      if (handlerControls.delayMs > 0) await delay(handlerControls.delayMs);
      if (!handlerControls.sessionAuthenticated) {
        return HttpResponse.json(unauthenticatedProblem as JsonBodyType, { status: 401 });
      }
      return HttpResponse.json(validSessionSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/navigation/context', async () => {
      await maybeDelay();
      const body = structuredClone(navigationBody);
      body.currentScope =
        mockScope.type === 'workspace'
          ? { type: 'workspace', lifecycle: 'active' }
          : { type: mockScope.type, id: mockScope.id, lifecycle: 'active' };
      return HttpResponse.json(body, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/register', async () => {
      handlerControls.registerRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validRegisterSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/login', async () => {
      handlerControls.loginRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validLoginSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/logout', async () => {
      handlerControls.logoutRequests += 1;
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(validLogoutSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/email/confirm', async () => {
      handlerControls.confirmEmailRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validConfirmEmailVerificationSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/request', async () => {
      handlerControls.requestPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validRequestPasswordResetSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/confirm', async () => {
      handlerControls.confirmPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validConfirmPasswordResetSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/change', async () => {
      handlerControls.changePasswordRequests += 1;
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(validChangePasswordSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/invitations/accept', async () => {
      handlerControls.acceptInvitationRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validAcceptInvitationSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/organizations/:organizationId/projects', async () => {
      handlerControls.listProjectsRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListProjectsSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/projects', async () => {
      handlerControls.createProjectRequests += 1;
      await maybeDelay();
      return HttpResponse.json(
        {
          projectId: 'prj_created_1',
          clientKeyPublicIdentifier: 'ck_pub_test_12345',
          defaultEnvironment: 'production',
          onboardingStatus: 'not_started',
          navigationTargets: [],
        } as JsonBodyType,
        { status: 200 },
      );
    }),
    http.get('/api/platform/v1/organizations/:organizationId/members', async () => {
      handlerControls.listMembersRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListMembersSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/invitations', async () => {
      handlerControls.inviteMemberRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validInviteMemberSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/revoke',
      async ({ params }) => {
        handlerControls.revokeInvitationRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { status: 'succeeded', invitationId: params.invitationId } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/resend',
      async ({ params }) => {
        handlerControls.resendInvitationRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            status: 'succeeded',
            invitationId: params.invitationId,
            expiresAt: '2026-08-23T01:00:00.000Z',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/members/:accountId/role',
      async ({ params, request }) => {
        handlerControls.changeRoleRequests += 1;
        await maybeDelay();
        const body = (await request.json()) as { orgRole: string };
        return HttpResponse.json(
          {
            accountId: params.accountId,
            orgRole: body.orgRole,
            resourceVersion: '0',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/members/:accountId/remove',
      async ({ params }) => {
        handlerControls.removeMemberRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { status: 'succeeded', accountId: params.accountId } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post('/api/platform/v1/organizations/:organizationId/ownership', async ({ request }) => {
      handlerControls.transferOwnershipRequests += 1;
      await maybeDelay();
      const body = (await request.json()) as { newOwnerAccountId: string };
      return HttpResponse.json(
        {
          organizationId: 'org_test_1',
          ownerAccountId: body.newOwnerAccountId,
          resourceVersion: '1',
          navigationTargets: [],
        } as JsonBodyType,
        { status: 200 },
      );
    }),
    http.patch(
      '/api/platform/v1/organizations/:organizationId/settings/timezone',
      async ({ request }) => {
        handlerControls.updateTimezoneRequests += 1;
        await maybeDelay();
        const body = (await request.json()) as { timezone: string };
        return HttpResponse.json(
          {
            organizationId: 'org_test_1',
            timezone: body.timezone,
            resourceVersion: '1',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get('/api/platform/v1/organizations/:organizationId/private-tokens', async () => {
      handlerControls.listPrivateTokensRequests += 1;
      await maybeDelay();
      // METADATA ONLY: no digest and no plaintext ever appears in the list.
      return HttpResponse.json(validListPrivateTokensSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/private-tokens', async () => {
      handlerControls.createPrivateTokenRequests += 1;
      await maybeDelay();
      // One-time plaintext delivery: the response carries `tokenPlaintext` once
      // and is served with Cache-Control: no-store. The mock mirrors the real
      // contract shape (the plaintext is never stored client-side).
      return HttpResponse.json(validCreatePrivateTokenSamples[0] as JsonBodyType, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/private-tokens/:tokenId/revoke',
      async ({ params }) => {
        handlerControls.revokePrivateTokenRequests += 1;
        await maybeDelay();
        return HttpResponse.json({ status: 'succeeded', tokenId: params.tokenId } as JsonBodyType, {
          status: 200,
        });
      },
    ),
    http.get('/api/platform/v1/organizations/:organizationId/audit', async () => {
      handlerControls.listSecurityAuditRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListSecurityAuditSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/organizations/:organizationId/trash', async () => {
      handlerControls.listTrashRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListTrashSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/trash/:projectId/restore',
      async () => {
        handlerControls.restoreProjectRequests += 1;
        await maybeDelay();
        return HttpResponse.json(validRestoreProjectSamples[0] as JsonBodyType, { status: 200 });
      },
    ),
    http.get('/api/platform/v1/auth/verify/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.email_verification as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/auth/reset/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.password_reset as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/auth/invitations/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.organization_invitation as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/intent/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.deletion_request as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/cancel/intent/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.deletion_cancel as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/preflight', async () => {
      handlerControls.deletionPreflightRequests += 1;
      await maybeDelay();
      const body =
        handlerControls.deletionPreflightStatus === 'blocked'
          ? DELETION_PREFLIGHT_BLOCKED
          : DELETION_PREFLIGHT_READY;
      return HttpResponse.json(body as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion/request', async () => {
      handlerControls.requestAccountDeletionRequests += 1;
      // Sending the confirmation email does not terminate the session; the user
      // returns from the email with the deletion_request intent cookie still on
      // the same browser to submit the delete command.
      await maybeDelay();
      return HttpResponse.json(REQUEST_ACCOUNT_DELETION_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion', async () => {
      handlerControls.deleteAccountRequests += 1;
      // Accepting deletion terminates every session; the user must re-login and
      // can only cancel through the emailed cancel link.
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(DELETE_ACCOUNT_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion/cancel', async () => {
      handlerControls.cancelDeletionRequests += 1;
      // Cancellation revokes every session; the account is active again but the
      // user must re-login.
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(CANCEL_DELETION_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/data-status',
      async ({ params }) => {
        handlerControls.dataStatusRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          mockDataStatus(String(params.organizationId), String(params.projectId)) as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues',
      async ({ request }) => {
        handlerControls.listIssuesRequests += 1;
        await maybeDelay();
        const search = new URL(request.url).searchParams;
        // The filtered fixture has a second page so browser tests can exercise
        // the public cursor protocol without altering production behavior.
        const nextCursor =
          search.get('status') === 'open' && search.get('cursor') === null ? 'cursor_2' : undefined;
        return HttpResponse.json(mockIssueList(nextCursor) as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId',
      async ({ params }) => {
        handlerControls.getIssueDetailRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockIssueDetail(String(params.issueId)) as JsonBodyType, {
          status: 200,
        });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/requests',
      async () => {
        handlerControls.listRequestEndpointsRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockRequestEndpoints() as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/performance',
      async () => {
        handlerControls.listPerformancePagesRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockPerformancePages() as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases',
      async () => {
        handlerControls.listReleasesRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockReleases() as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps',
      async () => {
        handlerControls.listSourceMapFilesRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockSourceMapFiles() as JsonBodyType, { status: 200 });
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/source-maps',
      async () => {
        handlerControls.uploadSourceMapRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: {
              status: 'uploaded',
              releaseId: 'release_test_1',
              sourceMapFileId: 'sm_test_1',
              version: 1,
            },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps/:sourceMapFileId/replace',
      async () => {
        handlerControls.replaceSourceMapRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'replaced', sourceMapFileId: 'sm_test_1', version: 2 },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/releases/:releaseId/reparse',
      async () => {
        handlerControls.reparseSourceMapRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { data: { status: 'queued', releaseId: 'release_test_1', taskCount: 1 } } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/capability',
      async () => {
        handlerControls.getAlertCapabilityRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockAlertCapability() as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts',
      async () => {
        handlerControls.listAlertsRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockAlerts() as JsonBodyType, { status: 200 });
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/instances/:instanceId',
      async ({ params }) => {
        handlerControls.getAlertInstanceDetailRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          mockAlertInstanceDetail(String(params.instanceId)) as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules',
      async () => {
        handlerControls.createAlertRuleRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { data: { status: 'succeeded', ruleId: 'rule_test_1' } } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/alerts/rules/:ruleId',
      async () => {
        handlerControls.updateAlertRuleRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { data: { status: 'succeeded', ruleId: 'rule_test_1', version: 2 } } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/access',
      async () => {
        handlerControls.listEffectiveMembersRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockEffectiveMembers() as JsonBodyType, { status: 200 });
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members',
      async () => {
        handlerControls.grantMembershipRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'granted', accountId: 'account_test_2', role: 'developer' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members/:accountId/role',
      async () => {
        handlerControls.projectChangeRoleRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'changed', accountId: 'account_test_2', role: 'project_admin' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/access/members/:accountId/remove',
      async () => {
        handlerControls.removeMembershipRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'removed', accountId: 'account_test_2', remainingSources: [] },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys',
      async () => {
        handlerControls.listClientKeysRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockClientKeys() as JsonBodyType, { status: 200 });
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys',
      async () => {
        handlerControls.createClientKeyRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: {
              status: 'created',
              credentialId: 'cred_test_2',
              keyId: 'ck_ijklmnop',
              clientKey: 'aurora_ingest_ijklmnop_testsecret',
              origins: [],
              environments: ['production'],
            },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/disable',
      async () => {
        handlerControls.disableClientKeyRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'disabled', credentialId: 'cred_test_1', keyId: 'ck_abcdefgh' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/enable',
      async () => {
        handlerControls.enableClientKeyRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'enabled', credentialId: 'cred_test_1', keyId: 'ck_abcdefgh' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/client-keys/:keyId/revoke',
      async () => {
        handlerControls.revokeClientKeyRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'revoked', credentialId: 'cred_test_1', keyId: 'ck_abcdefgh' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings',
      async () => {
        handlerControls.getProjectSettingsRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockProjectSettings() as JsonBodyType, { status: 200 });
      },
    ),
    http.patch(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings',
      async () => {
        handlerControls.updateProjectSettingsRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: {
              status: 'updated',
              projectId: 'prj_test_1',
              name: 'Web shop',
              resourceVersion: '2026-08-12T00:01:00.000Z',
            },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings/environments',
      async () => {
        handlerControls.listEnvironmentsRequests += 1;
        await maybeDelay();
        return HttpResponse.json(mockProjectEnvironments() as JsonBodyType, { status: 200 });
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/settings/environments',
      async () => {
        handlerControls.createEnvironmentRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: { status: 'created', environmentId: 'env_test_2', name: 'staging' },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/archive',
      async () => {
        handlerControls.archiveLifecycleRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { data: { status: 'archived', projectId: 'prj_test_1' } } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/restore',
      async () => {
        handlerControls.restoreLifecycleRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { data: { status: 'restored', projectId: 'prj_test_1' } } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/projects/:projectId/lifecycle/move-to-trash',
      async () => {
        handlerControls.moveToTrashRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            data: {
              status: 'trashed',
              projectId: 'prj_test_1',
              trashedAt: '2026-08-12T00:00:00.000Z',
              recoverableUntil: '2026-08-19T00:00:00.000Z',
            },
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post('/__mock/scope', async ({ request }) => {
      const body = (await request.json()) as MockScope;
      setMockScope(
        body.type === 'workspace'
          ? { type: 'workspace' }
          : { type: body.type, id: body.id ?? 'prj_test_1' },
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/platform/v1/notifications', async () => {
      await maybeDelay();
      return HttpResponse.json(mockNotifications() as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/notifications/:notificationId/read', async ({ params }) => {
      await maybeDelay();
      const notificationId = String(params.notificationId ?? 'notif_test_2');
      return HttpResponse.json({ data: { status: 'read', notificationId } } as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/platform-admin/capability', async () => {
      await maybeDelay();
      return HttpResponse.json(mockPlatformAdminCapability() as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/platform-admin/policy/targets', async ({ request }) => {
      await maybeDelay();
      const q = new URL(request.url).searchParams.get('q');
      return HttpResponse.json(mockPolicyTargetSearch(q) as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/platform-admin/policy/default', async () => {
      await maybeDelay();
      return HttpResponse.json(mockPolicyDefaultProjection() as JsonBodyType, { status: 200 });
    }),
    http.get(
      '/api/platform/v1/platform-admin/policy/organizations/:organizationId/effective',
      async () => {
        await maybeDelay();
        return HttpResponse.json(mockPolicyOrganizationProjection() as JsonBodyType, {
          status: 200,
        });
      },
    ),
    http.get('/api/platform/v1/platform-admin/policy/projects/:projectId/effective', async () => {
      await maybeDelay();
      return HttpResponse.json(mockPolicyProjectProjection() as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/platform-admin/policy/default', async () => {
      await maybeDelay();
      return HttpResponse.json({ data: { status: 'set', version: 2 } } as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/platform-admin/policy/organizations/:organizationId', async () => {
      await maybeDelay();
      return HttpResponse.json({ data: { status: 'set', version: 2 } } as JsonBodyType, {
        status: 200,
      });
    }),
    http.post(
      '/api/platform/v1/platform-admin/policy/organizations/:organizationId/reset',
      async () => {
        await maybeDelay();
        return HttpResponse.json({ data: { status: 'reset' } } as JsonBodyType, { status: 200 });
      },
    ),
    http.post('/api/platform/v1/platform-admin/policy/projects/:projectId/limit', async () => {
      await maybeDelay();
      return HttpResponse.json({ data: { status: 'set', version: 2 } } as JsonBodyType, {
        status: 200,
      });
    }),
    http.post(
      '/api/platform/v1/platform-admin/policy/projects/:projectId/limit/clear',
      async () => {
        await maybeDelay();
        return HttpResponse.json({ data: { status: 'cleared' } } as JsonBodyType, { status: 200 });
      },
    ),
    http.post('/__mock/session', async ({ request }) => {
      const body = (await request.json()) as { authenticated?: boolean };
      persistSessionAuthenticated(body.authenticated ?? true);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/__mock/deletion-preflight', async ({ request }) => {
      const body = (await request.json()) as { status?: 'ready' | 'blocked' };
      persistDeletionPreflight(body.status === 'blocked' ? 'blocked' : 'ready');
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
