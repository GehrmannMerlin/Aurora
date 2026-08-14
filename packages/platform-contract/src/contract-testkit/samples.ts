export const validSessionSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-08T01:00:00.000Z' },
    csrf: 'csrf_test_token',
    navigation: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
  },
  {
    account: { accountId: 'acct_test_2', email: 'new@example.invalid', verified: false },
    authentication: 'pending_verification',
    session: { expiresAt: '2026-08-08T02:00:00.000Z', rotationDueAt: '2026-08-08T01:30:00.000Z' },
    csrf: 'csrf_test_token_2',
    navigation: [],
  },
];

export const invalidSessionSamples: readonly unknown[] = [
  {
    account: {},
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-08T01:00:00.000Z' },
    csrf: 't',
    navigation: [],
  },
  {
    account: {
      accountId: 'acct_test_1',
      email: 'user@example.invalid',
      verified: true,
      passwordHash: 'x',
    },
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-08T01:00:00.000Z', sessionId: 's_1' },
    csrf: 't',
    navigation: [],
  },
];

export const validNavigationSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    workspace: [
      { routeId: 'workspace.home', pathParams: {}, query: {} },
      { routeId: 'platform.resource-policies', pathParams: {}, query: {} },
    ],
    organizations: [
      {
        organizationId: 'org_test_1',
        name: 'Acme',
        projects: [
          {
            projectId: 'prj_test_1',
            name: 'Web',
            lifecycle: 'active',
            entry: {
              routeId: 'project.overview',
              pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' },
              query: {},
            },
          },
        ],
        entry: {
          routeId: 'workspace.home',
          pathParams: { organizationId: 'org_test_1' },
          query: {},
        },
      },
    ],
    currentScope: { type: 'project', id: 'prj_test_1', lifecycle: 'active' },
    defaultTarget: {
      routeId: 'project.overview',
      pathParams: { organizationId: 'org_test_1', projectId: 'prj_test_1' },
      query: {},
    },
    safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
    unreadCount: { value: 0, status: 'available' },
  },
];

export const invalidNavigationSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    workspace: [],
    organizations: [],
    currentScope: { type: 'workspace', lifecycle: 'active' },
    defaultTarget: { routeId: 'anything.goes', pathParams: {}, query: {} },
    safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
    unreadCount: { status: 'unavailable' },
  },
];

export const validProblemSamples: readonly unknown[] = [
  {
    type: 'about:blank',
    title: 'Not found',
    status: 404,
    detail: 'Resource not found.',
    code: 'not_found',
    requestId: 'req_test_1',
  },
];

export const invalidProblemSamples: readonly unknown[] = [
  {
    type: 'about:blank',
    title: 'Bad',
    status: 404,
    detail: 'x',
    code: 'not_found',
    requestId: 'req_test_1',
    extra: 'leak',
  },
];

export const validRegisterSamples: readonly unknown[] = [
  {
    accountId: 'acct_test_1',
    workspaceId: { organizationId: 'org_test_1' },
    emailMasked: 'us**@example.invalid',
    verificationStatus: { verified: false, reason: 'email_verification_pending' },
    resendAvailableAt: '2026-08-09T01:05:00.000Z',
    serverTime: '2026-08-09T01:00:00.000Z',
  },
];

export const validLoginSamples: readonly unknown[] = [
  {
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
    authentication: 'authenticated',
    session: { expiresAt: '2026-08-09T02:00:00.000Z' },
    csrf: 'csrf_test_token',
    navigation: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
  },
];

export const validLogoutSamples: readonly unknown[] = [
  { status: 'succeeded', serverTime: '2026-08-09T01:00:00.000Z' },
];

export const validRequestPasswordResetSamples: readonly unknown[] = [
  {
    serverTime: '2026-08-09T01:00:00.000Z',
    nextRequestAllowedAt: '2026-08-09T01:05:00.000Z',
  },
];

export const validConfirmPasswordResetSamples: readonly unknown[] = [
  { status: 'succeeded', serverTime: '2026-08-09T01:00:00.000Z' },
];

export const validChangePasswordSamples: readonly unknown[] = [
  { status: 'succeeded', sessionImpact: 'revoked_all' },
];

export const validConfirmEmailVerificationSamples: readonly unknown[] = [
  {
    verificationStatus: { verified: true },
    account: { accountId: 'acct_test_1', email: 'user@example.invalid', verified: true },
  },
];

export const validAcceptInvitationSamples: readonly unknown[] = [
  {
    organization: { organizationId: 'org_test_1', name: 'Acme', role: 'member' },
    navigationTargets: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
  },
];

export const validListProjectsSamples: readonly unknown[] = [
  {
    projects: [
      {
        projectId: 'prj_test_1',
        name: 'Web',
        frameworkType: 'vue',
        status: 'active',
        lifecycle: 'active',
      },
    ],
    allowedActions: ['create'],
    navigationTargets: [
      { routeId: 'workspace.home', pathParams: { organizationId: 'org_test_1' }, query: {} },
    ],
  },
];

export const validListMembersSamples: readonly unknown[] = [
  {
    members: [
      { accountId: 'acct_test_1', emailMasked: 'ow**@example.invalid', orgRole: 'owner' },
      {
        accountId: 'acct_test_2',
        emailMasked: 'me**@example.invalid',
        orgRole: 'member',
        joinedAt: '2026-08-09T01:00:00.000Z',
      },
    ],
    navigationTargets: [
      { routeId: 'organization.members', pathParams: { organizationId: 'org_test_1' }, query: {} },
    ],
  },
];

export const validInviteMemberSamples: readonly unknown[] = [
  {
    invitationId: 'inv_test_1',
    invitedEmailMasked: 'ne**@example.invalid',
    expiresAt: '2026-08-16T01:00:00.000Z',
    status: 'pending',
  },
];

export const validUpdateTimezoneSamples: readonly unknown[] = [
  {
    organizationId: 'org_test_1',
    timezone: 'Asia/Shanghai',
    resourceVersion: 'v1',
  },
];

export const validListTrashSamples: readonly unknown[] = [
  {
    projects: [
      {
        projectId: 'prj_test_2',
        name: 'Legacy',
        frameworkType: 'javascript',
        trashedAt: '2026-08-01T01:00:00.000Z',
        recoverableUntil: '2026-08-08T01:00:00.000Z',
        lifecycle: 'trash',
      },
    ],
    navigationTargets: [
      { routeId: 'organization.trash', pathParams: { organizationId: 'org_test_1' }, query: {} },
    ],
  },
];

export const validRestoreProjectSamples: readonly unknown[] = [
  {
    projectId: 'prj_test_2',
    status: 'active',
    lifecycle: 'active',
    navigationTargets: [
      { routeId: 'workspace.home', pathParams: { organizationId: 'org_test_1' }, query: {} },
    ],
  },
];

export const validListPrivateTokensSamples: readonly unknown[] = [
  {
    tokens: [
      {
        tokenId: 'pt_test_1',
        name: 'ci-token',
        scopes: ['source_maps.upload'],
        expiresAt: '2026-09-01T01:00:00.000Z',
        lastUsedAt: '2026-08-09T01:00:00.000Z',
      },
    ],
    navigationTargets: [
      { routeId: 'organization.tokens', pathParams: { organizationId: 'org_test_1' }, query: {} },
    ],
  },
];

export const validCreatePrivateTokenSamples: readonly unknown[] = [
  {
    tokenId: 'pt_test_2',
    tokenPlaintext: 'aurora_pt_pt_test_2_abcdef1234567890',
    scopes: ['releases.write'],
    expiresAt: '2026-09-01T01:00:00.000Z',
  },
];

export const validListSecurityAuditSamples: readonly unknown[] = [
  {
    events: [
      {
        eventId: 'aud_test_1',
        action: 'member.invited',
        occurredAt: '2026-08-09T01:00:00.000Z',
        result: 'succeeded',
        actorMasked: 'ow**@example.invalid',
        targetProjectRef: { projectId: 'prj_test_1' },
      },
    ],
    pagination: { totalCountStatus: 'available' },
  },
];

export const validListNotificationsSamples: readonly unknown[] = [
  {
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
            occurredAt: '2026-08-10T12:00:00.000Z',
            readAt: '2026-08-10T12:05:00.000Z',
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
        ],
        pagination: { nextCursor: 'cGFnZS0y', totalCount: 1, totalCountStatus: 'available' },
      },
      unreadCount: { value: 0, status: 'available' },
    },
    meta: { requestId: 'req_test_1', readAt: '2026-08-10T12:06:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [],
  },
];

export const validMarkNotificationReadSamples: readonly unknown[] = [
  {
    data: { status: 'read', notificationId: 'notif_test_1' },
  },
];

export const validPlatformAdminGetCapabilitySamples: readonly unknown[] = [
  { data: { hasCapability: true } },
  { data: { hasCapability: false } },
];

export const validPlatformAdminListSamples: readonly unknown[] = [
  {
    data: {
      admins: {
        status: 'available',
        items: [
          {
            accountId: 'acct_test_1',
            grantedBy: 'acct_test_2',
            grantedAt: '2026-08-12T01:00:00.000Z',
          },
        ],
        pagination: { nextCursor: 'cGFnZS0y', totalCount: 1, totalCountStatus: 'available' },
      },
    },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [{ routeId: 'platform.resource-policies', pathParams: {}, query: {} }],
  },
];

export const validPlatformAdminGrantSamples: readonly unknown[] = [
  { data: { status: 'granted', accountId: 'acct_test_3' } },
];

export const validPlatformAdminRevokeSamples: readonly unknown[] = [
  { data: { status: 'revoked', accountId: 'acct_test_3' } },
];

export const validPlatformAuditListEventsSamples: readonly unknown[] = [
  {
    data: {
      events: {
        status: 'available',
        items: [
          {
            eventId: 'aud_test_2',
            action: 'admin_granted',
            actorAccountId: 'acct_test_2',
            target: { accountId: 'acct_test_3' },
            result: 'succeeded',
            occurredAt: '2026-08-12T01:00:00.000Z',
            requestId: 'req_test_1',
          },
        ],
        pagination: { nextCursor: 'cGFnZS0y', totalCount: 1, totalCountStatus: 'available' },
      },
    },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [],
  },
];

// ---------------------------------------------------------------------------
// D2 platform resource policy (PLT-10b) samples
// ---------------------------------------------------------------------------

const validDefaultPolicyProjection = {
  configured: {
    defaultPeriodQuota: 1000000,
    warningRatio: 80,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 90,
  },
  source: 'system_default',
  effective: {
    defaultPeriodQuota: 1000000,
    warningRatio: 80,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 90,
  },
  version: 1,
  updatedAt: '2026-08-12T01:00:00.000Z',
  updatedBy: 'acct_test_1',
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

const validOrgOverrideProjection = {
  configured: {
    defaultPeriodQuota: 500000,
    warningRatio: 85,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 60,
  },
  source: 'platform_admin',
  effective: {
    defaultPeriodQuota: 500000,
    warningRatio: 85,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 60,
  },
  version: 3,
  updatedAt: '2026-08-12T01:00:00.000Z',
  updatedBy: 'acct_test_1',
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

const validProjectPolicyProjection = {
  configured: { resourceLimit: 50000 },
  source: 'platform_admin',
  effective: {
    defaultPeriodQuota: 500000,
    warningRatio: 85,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 60,
    resourceLimit: 50000,
  },
  version: 2,
  updatedAt: '2026-08-12T01:00:00.000Z',
  updatedBy: 'acct_test_1',
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

export const validPolicyTargetSearchSamples: readonly unknown[] = [
  {
    data: {
      organizations: [{ organizationId: 'org_test_1', name: 'Acme' }],
      projects: [{ projectId: 'prj_test_1', organizationId: 'org_test_1', name: 'Web' }],
      pagination: { totalCount: 2, totalCountStatus: 'available' },
    },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [],
  },
];

export const validPolicyGetDefaultSamples: readonly unknown[] = [
  {
    data: { data: validDefaultPolicyProjection },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [{ routeId: 'platform.resource-policies', pathParams: {}, query: {} }],
  },
];

export const validPolicyGetOrganizationEffectiveSamples: readonly unknown[] = [
  {
    data: { data: validOrgOverrideProjection },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [{ routeId: 'platform.resource-policies', pathParams: {}, query: {} }],
  },
];

export const validPolicyGetProjectEffectiveSamples: readonly unknown[] = [
  {
    data: { data: validProjectPolicyProjection },
    meta: { requestId: 'req_test_1', readAt: '2026-08-12T01:05:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [],
  },
];

export const validPolicySetDefaultSamples: readonly unknown[] = [
  { data: { status: 'set', version: 4 } },
];

export const validPolicySetOrganizationSamples: readonly unknown[] = [
  { data: { status: 'set', version: 3 } },
];

export const validPolicyResetOrganizationSamples: readonly unknown[] = [
  { data: { status: 'reset' } },
];

export const validPolicySetProjectLimitSamples: readonly unknown[] = [
  { data: { status: 'set', version: 2 } },
];

export const validPolicyClearProjectLimitSamples: readonly unknown[] = [
  { data: { status: 'cleared' } },
];
