<script setup lang="ts">
import type { OrganizationNav, ProjectNav } from '../../stores/navigation';

defineProps<{
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
</script>

<template>
  <Teleport to="body">
    <nav v-if="openMenu !== null" class="au-scope-overlay" aria-label="作用域选择">
      <ul v-if="openMenu === 'organization'" id="organization-scope-menu" class="au-scope-menu" role="menu" aria-label="选择组织" :style="menuPosition" @keydown.esc.stop="emit('close-and-restore-focus')">
        <li v-if="organizationMessage !== null" class="au-scope-message" role="none">{{ organizationMessage }}</li>
        <li v-for="organization in organizations" :key="organization.organizationId" role="none">
          <button class="au-scope-option" type="button" role="menuitem" :aria-current="organization.organizationId === currentOrganizationId ? 'true' : undefined" :aria-label="organization.organizationId === currentOrganizationId ? `${organization.name}（当前）` : organization.name" @click="emit('select-organization', organization.organizationId)">
            <span>{{ organization.name }}</span><span v-if="organization.organizationId === currentOrganizationId" class="au-scope-current">（当前）</span>
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">{{ switchError }}</li>
      </ul>
      <ul v-if="openMenu === 'project'" id="project-scope-menu" class="au-scope-menu" role="menu" aria-label="选择项目" :style="menuPosition" @keydown.esc.stop="emit('close-and-restore-focus')">
        <li v-if="projectMessage !== null" class="au-scope-message" role="none">{{ projectMessage }}</li>
        <li v-for="project in projectOptions" :key="project.projectId" role="none">
          <button class="au-scope-option" type="button" role="menuitem" :aria-current="project.projectId === currentProjectId ? 'true' : undefined" :aria-label="project.projectId === currentProjectId ? `${project.name}（当前）` : project.name" @click="emit('select-project', project.projectId)">
            <span>{{ project.name }}</span><span v-if="project.projectId === currentProjectId" class="au-scope-current">（当前）</span>
          </button>
        </li>
        <li v-if="switchError !== null" class="au-scope-error" role="alert">{{ switchError }}</li>
      </ul>
    </nav>
  </Teleport>
</template>

<style>
.au-scope-overlay { display: contents; }
.au-scope-menu { position: fixed; z-index: 1000; width: max-content; min-width: 220px; max-width: min(320px, calc(100vw - 16px)); max-height: min(360px, calc(100vh - var(--nav-height) - 16px)); margin: 0; padding: var(--space-2); overflow-y: auto; border: 1px solid var(--color-border-default); border-radius: var(--radius-control); background: var(--color-surface-bg); box-shadow: 0 10px 24px rgb(15 23 42 / 16%); color: var(--color-text-primary); list-style: none; }
.au-scope-option { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: var(--control-height); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-control); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.au-scope-option:hover, .au-scope-option:focus-visible { background: var(--color-sidebar-active-bg); }
.au-scope-current { margin-left: var(--space-3); color: var(--color-text-secondary); font-size: .8125rem; }
.au-scope-message, .au-scope-error { max-width: 280px; padding: var(--space-3); color: var(--color-text-secondary); white-space: normal; }
.au-scope-error { color: var(--color-status-danger); }
</style>
