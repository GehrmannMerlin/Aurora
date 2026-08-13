<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';

const navigation = useNavigationStore();
const route = useRoute();
const router = useRouter();
const { organizations, currentOrganizationId } = storeToRefs(navigation);

const selected = computed(() => {
  const routeOrganizationId = route.params.organizationId;
  if (
    typeof routeOrganizationId === 'string' &&
    organizations.value.some((organization) => organization.organizationId === routeOrganizationId)
  ) {
    return routeOrganizationId;
  }
  return currentOrganizationId.value ?? '';
});
const projects = computed(
  () =>
    organizations.value.find((organization) => organization.organizationId === selected.value)
      ?.projects ?? [],
);
const selectedProject = computed(() => {
  const projectId = route.params.projectId;
  return typeof projectId === 'string' ? projectId : '';
});

function onOrgChange(event: Event): void {
  const organizationId = (event.target as HTMLSelectElement).value;
  if (organizationId.length === 0) return;
  navigation.selectOrganization(organizationId);
  void router.push({ path: '/workspace', query: { organizationId } });
}

function onProjectChange(event: Event): void {
  const projectId = (event.target as HTMLSelectElement).value;
  const organizationId = selected.value;
  if (projectId.length === 0 || organizationId.length === 0) return;
  const resolved = resolveRouteTarget({
    routeId: 'project.overview',
    pathParams: { organizationId, projectId },
    query: {},
  });
  if (resolved.path !== undefined) void router.push(resolved.path);
}
</script>

<template>
  <div class="au-scope-switch">
    <label class="au-scope-label" for="scope-org">组织</label>
    <select id="scope-org" class="au-select" :value="selected" @change="onOrgChange">
      <option value="">未选择</option>
      <option v-for="org in organizations" :key="org.organizationId" :value="org.organizationId">
        {{ org.name }}
      </option>
    </select>
    <label class="au-scope-label" for="scope-project">项目</label>
    <select
      id="scope-project"
      class="au-select"
      :value="selectedProject"
      :disabled="projects.length === 0"
      @change="onProjectChange"
    >
      <option value="">{{ projects.length === 0 ? '暂无项目' : '请选择项目' }}</option>
      <option v-for="project in projects" :key="project.projectId" :value="project.projectId">
        {{ project.name }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.au-scope-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.au-select {
  height: var(--control-height);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: 0 var(--space-2);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
}
</style>
