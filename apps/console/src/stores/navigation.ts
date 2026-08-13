import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { OPERATION_ID_NAVIGATION } from '@aurora/platform-contract';
import { ApiError } from '../api/errors.js';
import { invalidateScope, executeQuery } from '../api/query.js';

export type NavigationStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface RouteTargetRef {
  readonly routeId: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface ProjectNav {
  readonly projectId: string;
  readonly name: string;
  readonly lifecycle: 'active' | 'archived';
  readonly entry: RouteTargetRef;
}

export interface OrganizationNav {
  readonly organizationId: string;
  readonly name: string;
  readonly projects: readonly ProjectNav[];
  readonly entry: RouteTargetRef;
}

export type ScopeState = null | {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
  readonly lifecycle: 'active' | 'archived' | 'trash';
};

interface NavigationContextResponse {
  readonly account: {
    readonly accountId: string;
    readonly email: string;
    readonly verified: boolean;
  };
  readonly workspace: readonly RouteTargetRef[];
  readonly organizations: readonly OrganizationNav[];
  readonly currentScope: ScopeState;
  readonly defaultTarget: RouteTargetRef;
  readonly safeExitTarget: RouteTargetRef;
  readonly unreadCount: {
    readonly value?: number;
    readonly status: 'available' | 'unavailable';
  };
}

export interface UnreadCountProjection {
  readonly value?: number;
  readonly status: 'available' | 'unavailable';
}

export const useNavigationStore = defineStore('navigation', () => {
  // Generation counter: clear() bumps it so an in-flight load can never
  // resurrect scope state committed before the clear (scope-switch safety).
  let epoch = 0;
  const status = ref<NavigationStatus>('idle');
  const workspaceTargets = ref<readonly RouteTargetRef[]>([]);
  const organizations = ref<readonly OrganizationNav[]>([]);
  const currentScope = ref<ScopeState>(null);
  const defaultTarget = ref<RouteTargetRef | null>(null);
  const safeExitTarget = ref<RouteTargetRef | null>(null);
  const unreadCount = ref<UnreadCountProjection>({ status: 'unavailable' });

  const currentOrganizationId = computed<string | null>(() => {
    if (currentScope.value?.type === 'organization') return currentScope.value.id ?? null;
    if (currentScope.value?.type === 'project') {
      for (const org of organizations.value) {
        if (org.projects.some((project) => project.projectId === currentScope.value?.id)) {
          return org.organizationId;
        }
      }
    }
    return null;
  });

  async function load(): Promise<void> {
    if (status.value === 'loading' || status.value === 'ready') return;
    status.value = 'loading';
    const startedEpoch = epoch;
    try {
      const data = await executeQuery<NavigationContextResponse>({
        operationId: OPERATION_ID_NAVIGATION,
        scope: { type: 'workspace' },
        input: {},
      });
      if (startedEpoch !== epoch) return; // clear() ran while the request was in flight
      workspaceTargets.value = data.workspace;
      organizations.value = data.organizations;
      currentScope.value = data.currentScope;
      defaultTarget.value = data.defaultTarget;
      safeExitTarget.value = data.safeExitTarget;
      unreadCount.value = data.unreadCount;
      status.value = 'ready';
    } catch (caught) {
      if (startedEpoch !== epoch) return; // do not overwrite a post-clear state with 'unavailable'
      status.value = 'unavailable';
      workspaceTargets.value = [];
      organizations.value = [];
      currentScope.value = null;
      defaultTarget.value = null;
      safeExitTarget.value = null;
      unreadCount.value = { status: 'unavailable' };
      if (caught instanceof ApiError) {
        // safe empty state; error code is intentionally not surfaced to the UI
      }
    }
  }

  function clear(): void {
    epoch += 1;
    invalidateScope({ type: 'workspace' });
    status.value = 'idle';
    workspaceTargets.value = [];
    organizations.value = [];
    currentScope.value = null;
    defaultTarget.value = null;
    safeExitTarget.value = null;
    unreadCount.value = { status: 'unavailable' };
  }

  /**
   * PLT-09: sync the account-level unread badge from an authoritative source
   * (e.g. the D1 notifications list response after a successful mark-read).
   * Only accepts server-confirmed values; never fabricates a count.
   */
  function applyUnreadCount(
    value: number | undefined,
    countStatus: 'available' | 'unavailable',
  ): void {
    unreadCount.value =
      countStatus === 'available' && value !== undefined
        ? { value, status: 'available' }
        : { status: 'unavailable' };
  }

  return {
    status,
    workspaceTargets,
    organizations,
    currentScope,
    defaultTarget,
    safeExitTarget,
    unreadCount,
    currentOrganizationId,
    load,
    clear,
    applyUnreadCount,
  };
});
