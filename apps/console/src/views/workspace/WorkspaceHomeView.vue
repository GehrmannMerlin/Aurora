<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { OPERATION_ID_LIST_PROJECTS } from '@aurora/platform-contract';
import { executeQuery } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { useNavigationStore } from '../../stores/navigation.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

interface ProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly frameworkType: 'javascript' | 'react' | 'vue' | 'other';
  readonly status: 'active' | 'archived' | 'trash';
  readonly lifecycle: 'active' | 'archived' | 'trash';
}

interface ListProjectsResponse {
  readonly projects: readonly ProjectSummary[];
  readonly allowedActions: readonly string[];
  readonly navigationTargets: readonly unknown[];
}

const route = useRoute();
const router = useRouter();
const navigation = useNavigationStore();
const { status: navStatus, organizations, currentOrganizationId } = storeToRefs(navigation);

const projects = ref<readonly ProjectSummary[]>([]);
const allowedActions = ref<readonly string[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

// The shell loads the navigation context when the session becomes authenticated;
// loading it here too keeps the page correct when rendered directly (tests) or
// when navigation was not yet started. load() is idempotent.
if (navStatus.value === 'idle') void navigation.load();

const activeOrgId = computed<string | null>(() => {
  const fromQuery = route.query.organizationId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  if (currentOrganizationId.value !== null) return currentOrganizationId.value;
  const first = organizations.value[0];
  return first?.organizationId ?? null;
});

const activeOrg = computed(
  () => organizations.value.find((org) => org.organizationId === activeOrgId.value) ?? null,
);

const canCreateProject = computed(() => allowedActions.value.includes('create'));

function describeProjectsError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有权限查看该组织的项目。';
    if (caught.code === 'not_found') return '组织不存在或你没有访问权限。';
  }
  return describeRequestError(caught);
}

async function loadProjects(): Promise<void> {
  const orgId = activeOrgId.value;
  if (orgId === null) {
    projects.value = [];
    allowedActions.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<ListProjectsResponse>({
      operationId: OPERATION_ID_LIST_PROJECTS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    projects.value = data.projects;
    allowedActions.value = data.allowedActions;
  } catch (caught) {
    projects.value = [];
    allowedActions.value = [];
    loadError.value = describeProjectsError(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  activeOrgId,
  () => {
    void loadProjects();
  },
  { immediate: true },
);

function orgHref(organizationId: string): string {
  const result = resolveRouteTarget({ routeId: 'workspace.home', pathParams: {}, query: {} });
  const base = result.path ?? '/workspace';
  return `${base}?organizationId=${encodeURIComponent(organizationId)}`;
}

function createProjectHref(): string {
  const result = resolveRouteTarget({
    routeId: 'organization.project-create',
    pathParams: { organizationId: activeOrgId.value ?? '' },
    query: {},
  });
  return result.path ?? '/not-found';
}

function onCreateProject(): void {
  const href = createProjectHref();
  void router.push(href);
}

function projectHref(projectId: string): string {
  const result = resolveRouteTarget({
    routeId: 'project.overview',
    pathParams: { organizationId: activeOrgId.value ?? '', projectId },
    query: {},
  });
  return result.path ?? '/not-found';
}
</script>

<template>
  <section data-testid="workspace-home" class="au-surface">
    <AppPageHeader title="工作空间" />
    <p class="au-hint">选择组织查看其项目。项目列表按账号在组织内的权限由服务端过滤。</p>

    <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="projects-error">
      {{ loadError }}
    </AppStatusBadge>

    <p v-if="navStatus === 'unavailable'" class="au-hint" data-testid="nav-unavailable">
      导航上下文不可用；不会伪造组织或项目入口。
    </p>

    <template v-else>
      <div v-if="organizations.length > 0" class="au-org-tabs">
        <AppLink
          v-for="org in organizations"
          :key="org.organizationId"
          :to="orgHref(org.organizationId)"
          :active="org.organizationId === activeOrgId"
        >
          {{ org.name }}
        </AppLink>
      </div>
      <p v-else-if="navStatus === 'ready'" class="au-hint" data-testid="no-orgs">
        没有可访问的组织。
      </p>

      <template v-if="activeOrg !== null">
        <div class="au-projects-head">
          <h2 class="au-projects-title">{{ activeOrg.name }} 的项目</h2>
          <AppButton
            v-if="canCreateProject && projects.length > 0"
            variant="secondary"
            data-testid="create-project-button"
            @click="onCreateProject"
          >
            创建项目
          </AppButton>
        </div>
        <div v-if="loading" class="au-hint" role="status" data-testid="projects-loading">
          正在加载项目…
        </div>
        <div v-else-if="projects.length === 0" class="au-empty-card" data-testid="projects-empty">
          <h3 class="au-empty-title">开始使用 Aurora</h3>
          <p class="au-hint">你还没有项目，创建第一个项目开始监控应用。</p>
          <p class="au-hint">创建项目后可获得 SDK 接入配置并发送第一条测试错误。</p>
          <AppButton
            v-if="canCreateProject"
            variant="primary"
            data-testid="create-project-empty-button"
            @click="onCreateProject"
          >
            创建项目
          </AppButton>
        </div>
        <ul v-else class="au-project-list" data-testid="project-list">
          <li v-for="project in projects" :key="project.projectId" class="au-project-item">
            <AppLink :to="projectHref(project.projectId)">{{ project.name }}</AppLink>
            <span class="au-project-meta">{{ project.frameworkType }}</span>
            <AppStatusBadge :tone="project.lifecycle === 'active' ? 'success' : 'neutral'">
              {{ project.lifecycle }}
            </AppStatusBadge>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
}
.au-org-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}
.au-projects-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.au-projects-title {
  margin: 0;
  font-size: 16px;
  color: var(--color-text-primary);
}
.au-project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-project-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-project-meta {
  color: var(--color-text-secondary);
}
.au-empty-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
}
.au-empty-title {
  margin: 0;
  color: var(--color-text-primary);
}
.au-empty-card .au-hint {
  margin: 0;
}
</style>
