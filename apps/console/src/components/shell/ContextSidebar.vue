<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { ROUTE_BY_ID, resolveRouteTarget } from '../../contracts/route-registry';
import type { RouteEntry } from '../../contracts/route-types';
import type { RouteTargetId } from '@aurora/platform-contract';
import { ORG_SIDEBAR_GROUPS, PROJECT_SIDEBAR_GROUPS } from '../../contracts/sidebar-entries';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';
import ScopeSwitcher from './ScopeSwitcher.vue';

const props = withDefaults(defineProps<{ fill?: boolean; mobile?: boolean }>(), { fill: false, mobile: false });
const emit = defineEmits<{ (event: 'navigate'): void }>();
const route = useRoute();
const navigation = useNavigationStore();
const { status, currentOrganizationId, currentScope } = storeToRefs(navigation);
const scope = computed(() => route.meta.scope);
const isOrganization = computed(() => scope.value === 'organization');
const isProject = computed(() => scope.value === 'project');
const navigationLabel = computed(() => (isOrganization.value ? '组织导航' : '项目导航'));
const groups = computed(() => (isOrganization.value ? ORG_SIDEBAR_GROUPS : PROJECT_SIDEBAR_GROUPS));
const currentRouteEntry = computed(() => ROUTE_BY_ID.get(String(route.name) as RouteTargetId));
function paramsFor(): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  if (currentOrganizationId.value !== null) params.organizationId = currentOrganizationId.value;
  if (currentScope.value?.type === 'project' && currentScope.value.id !== undefined) params.projectId = currentScope.value.id;
  return params;
}
function entriesFor(routeIds: readonly string[]): readonly RouteEntry[] {
  if (status.value !== 'ready') return [];
  return routeIds.map((routeId) => ROUTE_BY_ID.get(routeId as RouteTargetId)).filter((entry): entry is RouteEntry => entry !== undefined && entry.menu);
}
function hrefFor(routeId: string): string { return resolveRouteTarget({ routeId: routeId as never, pathParams: paramsFor(), query: {} }).path ?? '/not-found'; }
function isActive(routeId: string): boolean { return route.name === routeId || currentRouteEntry.value?.parent === routeId; }
</script>

<template>
  <nav v-if="isOrganization || isProject" class="au-context-sidebar" :class="{ 'au-context-sidebar--fill': props.fill, 'au-context-sidebar--mobile': props.mobile }" :aria-label="navigationLabel">
    <ScopeSwitcher :organization-active="isOrganization" :project-active="isProject" />
    <div v-for="group in groups" :key="group.label" class="au-context-sidebar__group">
      <h2>{{ group.label }}</h2>
      <ul>
        <li v-for="entry in entriesFor(group.routeIds)" :key="entry.routeId">
          <AppLink :to="hrefFor(entry.routeId)" :label="entry.label" :active="isActive(entry.routeId)" @click="emit('navigate')" />
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.au-context-sidebar { height: 100%; overflow-y: auto; padding: var(--space-3); background: var(--color-context-bg); color: var(--color-text-primary); }
.au-context-sidebar__group { margin-top: var(--space-5); }
.au-context-sidebar__group h2 { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font-size: .75rem; font-weight: 650; letter-spacing: .04em; }
.au-context-sidebar__group ul { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.au-context-sidebar :deep(.au-link) { display: flex; justify-content: flex-start; width: 100%; min-height: var(--compact-control-height); color: var(--color-text-secondary); }
.au-context-sidebar :deep(.au-link:hover), .au-context-sidebar :deep(.au-link:focus-visible), .au-context-sidebar :deep(.au-link--active) { color: var(--color-action-primary); }
.au-context-sidebar--mobile { min-height: auto; }
</style>
