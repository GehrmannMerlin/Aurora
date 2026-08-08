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
