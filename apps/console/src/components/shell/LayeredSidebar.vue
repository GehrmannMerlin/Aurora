<script setup lang="ts">
withDefaults(defineProps<{ fill?: boolean }>(), { fill: false });
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { ROUTE_BY_ID, resolveRouteTarget } from '../../contracts/route-registry';
import type { RouteEntry } from '../../contracts/route-types';
import {
  ORG_SIDEBAR_ENTRIES,
  PROJECT_SIDEBAR_ENTRIES,
  WORKSPACE_SIDEBAR_ENTRIES,
} from '../../contracts/sidebar-entries';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';

const route = useRoute();
const navigation = useNavigationStore();
const { status, currentScope, currentOrganizationId } = storeToRefs(navigation);

const entries = computed(() => {
  const routeProjectId = route.params.projectId;
  if (status.value !== 'ready') {
    return WORKSPACE_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry): entry is RouteEntry => entry !== undefined && entry.menu,
    );
  }
  if (typeof routeProjectId === 'string' && routeProjectId.length > 0) {
    return PROJECT_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
      (entry): entry is RouteEntry => entry !== undefined && entry.menu,
    );
  }
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
  return WORKSPACE_SIDEBAR_ENTRIES.map((id) => ROUTE_BY_ID.get(id)).filter(
    (entry): entry is RouteEntry => entry !== undefined && entry.menu,
  );
});

function paramsFor(): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  const orgId = currentOrganizationId.value;
  if (orgId !== null) params.organizationId = orgId;
  const routeOrganizationId = route.params.organizationId;
  if (typeof routeOrganizationId === 'string') params.organizationId = routeOrganizationId;
  const routeProjectId = route.params.projectId;
  if (typeof routeProjectId === 'string') {
    params.projectId = routeProjectId;
  } else if (currentScope.value?.type === 'project' && currentScope.value.id !== undefined) {
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
</script>

<template>
  <nav class="au-sidebar" :class="{ 'au-sidebar--fill': fill }" aria-label="侧栏导航">
    <ul class="au-sidebar-list">
      <li v-for="entry in entries" :key="entry.routeId">
        <AppLink
          :to="hrefFor(entry.routeId)"
          :label="entry.label"
          :active="route.name === entry.routeId"
        />
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.au-sidebar {
  width: 240px;
  flex-shrink: 0;
  padding: var(--space-4) 0;
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
.au-sidebar :deep(.au-link) {
  color: var(--color-sidebar-fg);
}
.au-sidebar :deep(.au-link--active) {
  background-color: var(--color-sidebar-active-bg);
  color: var(--color-sidebar-active-fg);
}
.au-sidebar--fill {
  width: 100%;
}
</style>
