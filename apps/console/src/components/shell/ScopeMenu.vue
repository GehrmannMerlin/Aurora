<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { OrganizationNav, ProjectNav } from '../../stores/navigation';

const props = defineProps<{
  openMenu: 'organization' | 'project' | null;
  organizations: readonly OrganizationNav[];
  projectOptions: readonly ProjectNav[];
  currentOrganizationId: string | null;
  currentProjectId: string | undefined;
  organizationMessage: string | null;
  projectMessage: string | null;
  switchError: string | null;
  menuPosition: { top: string; left: string };
}>();
const emit = defineEmits<{
  (event: 'select-organization', organizationId: string): void;
  (event: 'select-project', projectId: string): void;
  (event: 'close-and-restore-focus'): void;
}>();

const activeItemId = ref<string | null>(null);

function itemId(kind: 'organization' | 'project', id: string): string {
  return `${kind}:${id}`;
}

function initialItemId(menu: 'organization' | 'project'): string | null {
  if (menu === 'organization') {
    const current = props.organizations.find(
      (organization) => organization.organizationId === props.currentOrganizationId,
    );
    const first = current ?? props.organizations[0];
    return first === undefined ? null : itemId(menu, first.organizationId);
  }
  const current = props.projectOptions.find(
    (project) => project.projectId === props.currentProjectId,
  );
  const first = current ?? props.projectOptions[0];
  return first === undefined ? null : itemId(menu, first.projectId);
}

function itemTabIndex(id: string): number {
  return activeItemId.value === id ? 0 : -1;
}

function onItemFocus(id: string): void {
  activeItemId.value = id;
}

function onItemKeydown(event: KeyboardEvent): void {
  const current = event.currentTarget as HTMLButtonElement;
  const menu = current.closest<HTMLElement>('[role="menu"]');
  if (menu === null) return;
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
  );
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return;
  let destination: number | null = null;
  switch (event.key) {
    case 'ArrowDown':
      destination = (index + 1) % items.length;
      break;
    case 'ArrowUp':
      destination = (index - 1 + items.length) % items.length;
      break;
    case 'Home':
      destination = 0;
      break;
    case 'End':
      destination = items.length - 1;
      break;
    case 'Escape':
      event.preventDefault();
      emit('close-and-restore-focus');
      return;
    default:
      return;
  }
  event.preventDefault();
  if (destination === null) return;
  items[destination]?.focus();
}

watch(
  () => props.openMenu,
  async (menu) => {
    activeItemId.value = menu === null ? null : initialItemId(menu);
    if (activeItemId.value === null) return;
    await nextTick();
    document.getElementById(activeItemId.value)?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <nav v-if="openMenu !== null" class="au-scope-overlay" aria-label="作用域选择">
      <ul
        v-if="openMenu === 'organization'"
        id="organization-scope-menu"
        class="au-scope-menu"
        role="menu"
        aria-label="选择组织"
        :style="menuPosition"
      >
        <li v-if="organizationMessage !== null" class="au-scope-message" role="none">
          {{ organizationMessage }}
        </li>
        <li v-for="organization in organizations" :key="organization.organizationId" role="none">
          <button
            :id="itemId('organization', organization.organizationId)"
            class="au-scope-option"
            type="button"
            role="menuitem"
            :tabindex="itemTabIndex(itemId('organization', organization.organizationId))"
            :aria-current="
              organization.organizationId === currentOrganizationId ? 'true' : undefined
            "
            :aria-label="
              organization.organizationId === currentOrganizationId
                ? `${organization.name}（当前）`
                : organization.name
            "
            @focus="onItemFocus(itemId('organization', organization.organizationId))"
            @keydown="onItemKeydown"
            @click="emit('select-organization', organization.organizationId)"
          >
            <span>{{ organization.name }}</span
            ><span
              v-if="organization.organizationId === currentOrganizationId"
              class="au-scope-current"
              >（当前）</span
            >
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">{{ switchError }}</li>
      </ul>
      <ul
        v-if="openMenu === 'project'"
        id="project-scope-menu"
        class="au-scope-menu"
        role="menu"
        aria-label="选择项目"
        :style="menuPosition"
      >
        <li v-if="projectMessage !== null" class="au-scope-message" role="none">
          {{ projectMessage }}
        </li>
        <li v-for="project in projectOptions" :key="project.projectId" role="none">
          <button
            :id="itemId('project', project.projectId)"
            class="au-scope-option"
            type="button"
            role="menuitem"
            :tabindex="itemTabIndex(itemId('project', project.projectId))"
            :aria-current="project.projectId === currentProjectId ? 'true' : undefined"
            :aria-label="
              project.projectId === currentProjectId ? `${project.name}（当前）` : project.name
            "
            @focus="onItemFocus(itemId('project', project.projectId))"
            @keydown="onItemKeydown"
            @click="emit('select-project', project.projectId)"
          >
            <span>{{ project.name }}</span
            ><span v-if="project.projectId === currentProjectId" class="au-scope-current"
              >（当前）</span
            >
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">{{ switchError }}</li>
      </ul>
    </nav>
  </Teleport>
</template>

<style>
.au-scope-overlay {
  display: contents;
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
  border-radius: var(--radius-control);
  background: var(--color-surface-bg);
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
  border-radius: var(--radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.au-scope-option:hover,
.au-scope-option:focus-visible {
  background: var(--color-context-active-bg);
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
