<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore, type RouteTargetRef } from '../../stores/navigation';

const props = defineProps<{
  organizationActive: boolean;
  projectActive: boolean;
}>();

type MenuKind = 'organization' | 'project';
type OpenMenu = MenuKind | null;

const navigation = useNavigationStore();
const router = useRouter();
const route = useRoute();
const { status, organizations, currentOrganizationId, currentProject } = storeToRefs(navigation);
const root = ref<HTMLElement | null>(null);
const organizationTrigger = ref<HTMLButtonElement | null>(null);
const projectTrigger = ref<HTMLButtonElement | null>(null);
const organizationMenu = ref<HTMLElement | null>(null);
const projectMenu = ref<HTMLElement | null>(null);
const openMenu = ref<OpenMenu>(null);
const switchError = ref<string | null>(null);
const menuPosition = ref({ top: '0px', left: '0px' });

const currentOrganization = computed(() =>
  organizations.value.find((candidate) => candidate.organizationId === currentOrganizationId.value),
);
const organizationName = computed(() => {
  if (status.value === 'loading') return '加载中';
  if (status.value === 'unavailable') return '不可用';
  if (organizations.value.length === 0) return '暂无组织';
  return currentOrganization.value?.name ?? '请选择';
});
const projectName = computed(() => {
  if (status.value === 'loading') return '加载中';
  if (status.value === 'unavailable') return '不可用';
  if (currentOrganization.value === undefined) return '请先选择组织';
  if (currentOrganization.value.projects.length === 0) return '暂无项目';
  return currentProject.value?.name ?? '请选择';
});
const projectOptions = computed(() => currentOrganization.value?.projects ?? []);
const organizationMessage = computed(() => {
  if (status.value === 'loading') return '正在加载可访问组织…';
  if (status.value === 'unavailable') return '组织列表暂时不可用，请稍后重试。';
  if (organizations.value.length === 0) return '当前账号没有可访问的组织。';
  return null;
});
const projectMessage = computed(() => {
  if (status.value === 'loading') return '正在加载可访问项目…';
  if (status.value === 'unavailable') return '项目列表暂时不可用，请稍后重试。';
  if (currentOrganization.value === undefined) return '请先选择一个组织。';
  if (projectOptions.value.length === 0) return '当前组织没有可访问的项目。';
  return null;
});

function triggerFor(menu: MenuKind): HTMLButtonElement | null {
  return menu === 'organization' ? organizationTrigger.value : projectTrigger.value;
}

function menuFor(menu: MenuKind): HTMLElement | null {
  return menu === 'organization' ? organizationMenu.value : projectMenu.value;
}

function positionOpenMenu(menu: MenuKind): void {
  const trigger = triggerFor(menu);
  if (trigger === null) return;
  const rect = trigger.getBoundingClientRect();
  const width = 220;
  const gutter = 8;
  menuPosition.value = {
    top: `${rect.bottom + gutter}px`,
    left: `${Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter))}px`,
  };
}

async function open(menu: MenuKind): Promise<void> {
  switchError.value = null;
  openMenu.value = menu;
  await nextTick();
  positionOpenMenu(menu);
  menuFor(menu)?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
}

function toggle(menu: MenuKind): void {
  if (openMenu.value === menu) {
    close();
    return;
  }
  void open(menu);
}

function close(): void {
  openMenu.value = null;
  switchError.value = null;
}

function closeAndRestoreFocus(): void {
  if (openMenu.value === null) return;
  const trigger = triggerFor(openMenu.value);
  close();
  void nextTick(() => trigger?.focus());
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node;
  if (root.value?.contains(target)) return;
  if (organizationMenu.value?.contains(target)) return;
  if (projectMenu.value?.contains(target)) return;
  close();
}

function onViewportChange(): void {
  if (openMenu.value !== null) positionOpenMenu(openMenu.value);
}

function pathFor(target: RouteTargetRef): string | null {
  return (
    resolveRouteTarget({
      routeId: target.routeId as never,
      pathParams: target.pathParams,
      query: target.query,
    }).path ?? null
  );
}

async function selectOrganization(organizationId: string): Promise<void> {
  switchError.value = null;
  if (
    navigation.currentScope?.type === 'organization' &&
    navigation.currentScope.id === organizationId
  ) {
    close();
    return;
  }
  const organization = organizations.value.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (organization === undefined) {
    switchError.value = '该组织已不可用，请刷新后重试。';
    return;
  }
  const path = pathFor(organization.entry);
  if (path === null) {
    switchError.value = '无法打开该组织，请稍后重试。';
    return;
  }
  try {
    const failure = await router.push(path);
    if (failure !== undefined) {
      switchError.value = '组织切换失败，请重试。';
      return;
    }
    navigation.activateOrganization(organizationId);
    close();
  } catch {
    switchError.value = '组织切换失败，请重试。';
  }
}

async function selectProject(projectId: string): Promise<void> {
  switchError.value = null;
  if (currentProject.value?.projectId === projectId && route.meta.scope === 'project') {
    close();
    return;
  }
  const project = projectOptions.value.find((candidate) => candidate.projectId === projectId);
  if (project === undefined) {
    switchError.value = '该项目已不可用，请刷新后重试。';
    return;
  }
  const path = pathFor(project.entry);
  if (path === null) {
    switchError.value = '无法打开该项目，请稍后重试。';
    return;
  }
  try {
    const failure = await router.push(path);
    if (failure !== undefined) {
      switchError.value = '项目切换失败，请重试。';
      return;
    }
    navigation.activateProject(projectId);
    close();
  } catch {
    switchError.value = '项目切换失败，请重试。';
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});
watch(() => route.fullPath, close);
</script>

<template>
  <div ref="root" class="au-scope-switch" @keydown.esc.stop="closeAndRestoreFocus">
    <div class="au-scope-group">
      <button
        ref="organizationTrigger"
        class="au-scope-trigger"
        :class="{ 'au-scope-trigger--active': props.organizationActive }"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="openMenu === 'organization'"
        :aria-current="props.organizationActive ? 'page' : undefined"
        aria-controls="organization-scope-menu"
        :aria-label="`组织：${organizationName}`"
        @click="toggle('organization')"
        @keydown.down.prevent="open('organization')"
      >
        <span>组织</span>
        <span class="au-scope-value">{{ organizationName }}</span>
        <span class="au-scope-chevron" aria-hidden="true">⌄</span>
      </button>
    </div>

    <div class="au-scope-group">
      <button
        ref="projectTrigger"
        class="au-scope-trigger"
        :class="{ 'au-scope-trigger--active': props.projectActive }"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="openMenu === 'project'"
        :aria-current="props.projectActive ? 'page' : undefined"
        aria-controls="project-scope-menu"
        :aria-label="`项目：${projectName}`"
        @click="toggle('project')"
        @keydown.down.prevent="open('project')"
      >
        <span>项目</span>
        <span class="au-scope-value">{{ projectName }}</span>
        <span class="au-scope-chevron" aria-hidden="true">⌄</span>
      </button>
    </div>
  </div>

  <Teleport to="body">
    <nav v-if="openMenu !== null" class="au-scope-overlay" aria-label="作用域选择">
      <ul
        v-if="openMenu === 'organization'"
        id="organization-scope-menu"
        ref="organizationMenu"
        class="au-scope-menu"
        role="menu"
        aria-label="选择组织"
        :style="menuPosition"
        @keydown.esc.stop="closeAndRestoreFocus"
      >
        <li v-if="organizationMessage !== null" class="au-scope-message" role="none">
          {{ organizationMessage }}
        </li>
        <li v-for="organization in organizations" :key="organization.organizationId" role="none">
          <button
            class="au-scope-option"
            type="button"
            role="menuitem"
            :aria-current="
              organization.organizationId === currentOrganizationId ? 'true' : undefined
            "
            :aria-label="
              organization.organizationId === currentOrganizationId
                ? `${organization.name}（当前）`
                : organization.name
            "
            @click="selectOrganization(organization.organizationId)"
          >
            <span>{{ organization.name }}</span>
            <span
              v-if="organization.organizationId === currentOrganizationId"
              class="au-scope-current"
              >（当前）</span
            >
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">
          {{ switchError }}
        </li>
      </ul>

      <ul
        v-if="openMenu === 'project'"
        id="project-scope-menu"
        ref="projectMenu"
        class="au-scope-menu"
        role="menu"
        aria-label="选择项目"
        :style="menuPosition"
        @keydown.esc.stop="closeAndRestoreFocus"
      >
        <li v-if="projectMessage !== null" class="au-scope-message" role="none">
          {{ projectMessage }}
        </li>
        <li v-for="project in projectOptions" :key="project.projectId" role="none">
          <button
            class="au-scope-option"
            type="button"
            role="menuitem"
            :aria-current="project.projectId === currentProject?.projectId ? 'true' : undefined"
            :aria-label="
              project.projectId === currentProject?.projectId
                ? `${project.name}（当前）`
                : project.name
            "
            @click="selectProject(project.projectId)"
          >
            <span>{{ project.name }}</span>
            <span v-if="project.projectId === currentProject?.projectId" class="au-scope-current"
              >（当前）</span
            >
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">
          {{ switchError }}
        </li>
      </ul>
    </nav>
  </Teleport>
</template>

<style scoped>
.au-scope-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.au-scope-overlay {
  display: contents;
}
.au-scope-group {
  position: relative;
}
.au-scope-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--nav-height);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-base);
  background-color: transparent;
  color: var(--color-topbar-fg);
  font: inherit;
  cursor: pointer;
}
.au-scope-trigger:hover,
.au-scope-trigger:focus-visible,
.au-scope-trigger--active {
  background-color: rgb(248 250 252 / 12%);
}
.au-scope-trigger--active {
  box-shadow: inset 0 -3px var(--color-sidebar-active-indicator);
}
.au-scope-value {
  max-width: 144px;
  overflow: hidden;
  color: #ffffff;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.au-scope-chevron {
  font-size: 1rem;
  line-height: 1;
  transform: translateY(-1px);
}
.au-scope-menu {
  position: fixed;
  z-index: 1000;
  width: max-content;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - var(--nav-height) - 16px));
  margin: 0;
  padding: var(--space-2);
  overflow-y: auto;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  box-shadow: 0 10px 24px rgb(15 23 42 / 16%);
  color: var(--color-text-primary);
  list-style: none;
}
.au-scope-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-base);
  background-color: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.au-scope-option:hover,
.au-scope-option:focus-visible {
  background-color: var(--color-sidebar-active-bg);
}
.au-scope-current {
  margin-left: var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
}
.au-scope-message,
.au-scope-error {
  max-width: 280px;
  padding: var(--space-3);
  color: var(--color-text-secondary);
  white-space: normal;
}
.au-scope-error {
  color: var(--color-status-danger);
}
</style>
