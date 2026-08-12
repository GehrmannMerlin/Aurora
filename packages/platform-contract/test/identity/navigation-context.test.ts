import { describe, expect, it } from 'vitest';
import { navigationGetContextResponse } from '../../src/identity/navigation-context.js';

describe('navigationGetContext', () => {
  it('accepts a workspace-scoped navigation projection', () => {
    expect(
      navigationGetContextResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
        workspace: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
        organizations: [],
        currentScope: { type: 'workspace', lifecycle: 'active' },
        defaultTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
        safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
        unreadCount: { value: 0, status: 'available' },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-closed route target', () => {
    expect(
      navigationGetContextResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: true },
        workspace: [],
        organizations: [],
        currentScope: { type: 'workspace', lifecycle: 'active' },
        defaultTarget: { routeId: 'anything.goes', pathParams: {}, query: {} },
        safeExitTarget: { routeId: 'workspace.home', pathParams: {}, query: {} },
        unreadCount: { status: 'unavailable' },
      }).success,
    ).toBe(false);
  });
});
