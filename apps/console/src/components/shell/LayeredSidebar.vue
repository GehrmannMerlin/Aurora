<script setup lang="ts">
withDefaults(defineProps<{ fill?: boolean }>(), { fill: false });
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { ROUTE_BY_ID, resolveRouteTarget } from '../../contracts/route-registry';
import type { RouteEntry } from '../../contracts/route-types';
import { ORG_SIDEBAR_ENTRIES, PROJECT_SIDEBAR_ENTRIES } from '../../contracts/sidebar-entries';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';

const route = useRoute();
const navigation = useNavigationStore();
const { status, currentScope, currentOrganizationId } = storeToRefs(navigation);

const currentRouteEntry = computed(() =>
  typeof route.name === 'string' ? ROUTE_BY_ID.get(route.name as never) : undefined,
);

const entries = computed(() => {
  if (status.value !== 'ready') return [];
  if (currentScope.value?.type === 'organization') {
    return ORG_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry): entry is RouteEntry => entry !== undefined && entry.menu,
    );
  }
  if (currentScope.value?.type === 'project') {
    return PROJECT_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry): entry is RouteEntry => entry !== undefined && entry.menu,
    );
  }
  return [];
});

function paramsFor(): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  const orgId = currentOrganizationId.value;
  if (orgId !== null) params.organizationId = orgId;
  if (currentScope.value?.type === 'project' && currentScope.value.id !== undefined) {
    params.projectId = currentScope.value.id;
  }
  return params;
}

function hrefFor(routeId: string): string {
  return (
    resolveRouteTarget({ routeId: routeId as never, pathParams: paramsFor(), query: {} }).path ??
    '/not-found'
  );
}

function isActive(routeId: string): boolean {
  return route.name === routeId || currentRouteEntry.value?.parent === routeId;
}
</script>

<template>
  <nav class="au-sidebar" :class="{ 'au-sidebar--fill': fill }" aria-label="侧栏导航">
    <ul class="au-sidebar-list">
      <li v-for="entry in entries" :key="entry.routeId">
        <AppLink
          :to="hrefFor(entry.routeId)"
          :label="entry.label"
          :active="isActive(entry.routeId)"
        />
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.au-sidebar {
  width: var(--sidebar-width);
  height: 100%;
  flex-shrink: 0;
  overflow-y: auto;
  padding: var(--space-3) 0;
  background-color: var(--color-sidebar-bg);
  color: var(--color-sidebar-fg);
}
.au-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.au-sidebar-list > li {
  margin: 0 var(--space-3);
}
.au-sidebar :deep(.au-link) {
  position: relative;
  justify-content: center;
  width: 100%;
  min-height: var(--sidebar-row-height);
  padding: 0 var(--space-4);
  color: var(--color-sidebar-fg);
  text-align: center;
}
.au-sidebar :deep(.au-link--active) {
  background-color: var(--color-sidebar-active-bg);
  color: var(--color-sidebar-active-fg);
}
.au-sidebar :deep(.au-link--active::before) {
  position: absolute;
  top: var(--space-2);
  bottom: var(--space-2);
  left: 0;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background-color: var(--color-sidebar-active-indicator);
  content: '';
}
.au-sidebar--fill {
  width: 100%;
}
</style>
