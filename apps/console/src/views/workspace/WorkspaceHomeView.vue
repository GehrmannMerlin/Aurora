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
import AppEmptyState from '../../components/aurora/AppEmptyState.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
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

const frameworkLabel: Record<ProjectSummary['frameworkType'], string> = {
  javascript: 'JavaScript',
  react: 'React',
  vue: 'Vue',
  other: '其他',
};

const lifecycleLabel: Record<ProjectSummary['lifecycle'], string> = {
  active: '运行中',
  archived: '已归档',
  trash: '回收站',
};

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
    <AppPageHeader title="工作空间" description="在组织范围内选择和管理可访问项目。">
      <template #actions>
        <AppButton
          v-if="activeOrg !== null && canCreateProject"
          variant="primary"
          data-testid="create-project-button"
          @click="onCreateProject"
        >
          创建项目
        </AppButton>
      </template>
    </AppPageHeader>

    <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="projects-error">
      {{ loadError }}
    </AppStatusBadge>

    <p v-if="navStatus === 'unavailable'" class="au-hint" data-testid="nav-unavailable">
      导航上下文不可用；不会伪造组织或项目入口。
    </p>

    <template v-else>
      <div v-if="organizations.length > 0" class="au-org-tabs" data-testid="organization-scope">
        <AppLink
          v-for="org in organizations"
          :key="org.organizationId"
          :to="orgHref(org.organizationId)"
          :active="org.organizationId === activeOrgId"
        >
          {{ org.name }}
        </AppLink>
      </div>
      <AppEmptyState
        v-else-if="navStatus === 'ready'"
        title="没有可访问的组织"
        description="当前账号没有可进入的组织范围，因此无法展示项目。"
        data-testid="no-orgs"
      />

      <template v-if="activeOrg !== null">
        <AppSection :title="`${activeOrg.name} 的项目`" description="仅展示当前组织范围内允许访问的项目。">
          <AppSkeleton v-if="loading" label="正在加载项目…" :lines="4" data-testid="projects-loading" />
          <AppEmptyState
            v-else-if="projects.length === 0"
            title="该组织暂无项目"
            description="创建首个项目后，可在此处继续管理其观测设置。"
            data-testid="projects-empty"
          >
            <template v-if="canCreateProject" #actions>
              <AppButton variant="primary" @click="onCreateProject">创建项目</AppButton>
            </template>
          </AppEmptyState>
          <ul v-else class="au-project-list" data-testid="project-list">
            <li v-for="project in projects" :key="project.projectId" class="au-project-item" data-testid="project-row">
              <div class="au-project-item__identity">
                <AppLink :to="projectHref(project.projectId)">{{ project.name }}</AppLink>
                <span class="au-project-meta" data-testid="project-framework">{{ frameworkLabel[project.frameworkType] }}</span>
              </div>
              <AppStatusBadge :tone="project.lifecycle === 'active' ? 'success' : 'neutral'" data-testid="project-lifecycle">
                {{ lifecycleLabel[project.lifecycle] }}
              </AppStatusBadge>
              <AppLink :to="projectHref(project.projectId)" :aria-label="`打开项目 ${project.name}`" :data-testid="`open-project-${project.projectId}`">打开项目</AppLink>
            </li>
          </ul>
        </AppSection>
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
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border-default);
}
.au-project-item:last-child { border-bottom: 0; }
.au-project-item__identity { display: grid; gap: var(--space-1); }
.au-project-meta {
  color: var(--color-text-secondary);
}
</style>
