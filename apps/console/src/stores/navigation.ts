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
}

export const useNavigationStore = defineStore('navigation', () => {
  const status = ref<NavigationStatus>('idle');
  const workspaceTargets = ref<readonly RouteTargetRef[]>([]);
  const organizations = ref<readonly OrganizationNav[]>([]);
  const currentScope = ref<ScopeState>(null);
  const defaultTarget = ref<RouteTargetRef | null>(null);
  const safeExitTarget = ref<RouteTargetRef | null>(null);

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
    try {
      const data = (await executeQuery({
        operationId: OPERATION_ID_NAVIGATION,
        scope: { type: 'workspace' },
        input: {},
      })) as NavigationContextResponse;
      workspaceTargets.value = data.workspace;
      organizations.value = data.organizations;
      currentScope.value = data.currentScope;
      defaultTarget.value = data.defaultTarget;
      safeExitTarget.value = data.safeExitTarget;
      status.value = 'ready';
    } catch (caught) {
      status.value = 'unavailable';
      workspaceTargets.value = [];
      organizations.value = [];
      currentScope.value = null;
      defaultTarget.value = null;
      safeExitTarget.value = null;
      if (caught instanceof ApiError) {
        // safe empty state; error code is intentionally not surfaced to the UI
      }
    }
  }

  function clear(): void {
    invalidateScope({ type: 'workspace' });
    status.value = 'idle';
    workspaceTargets.value = [];
    organizations.value = [];
    currentScope.value = null;
    defaultTarget.value = null;
    safeExitTarget.value = null;
  }

  return {
    status,
    workspaceTargets,
    organizations,
    currentScope,
    defaultTarget,
    safeExitTarget,
    currentOrganizationId,
    load,
    clear,
  };
});
