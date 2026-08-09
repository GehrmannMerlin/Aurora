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
    workspace: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
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
